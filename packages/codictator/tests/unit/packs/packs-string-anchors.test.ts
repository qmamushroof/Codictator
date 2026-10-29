// SPEC §4.7.3, §4.9.2, §5.8, §5.9, §6.1: marker-word and extractor guards
// match reports, never substrings inside code strings. `includes("edited:")`
// flagged the guard's own source and status strings like "corrupt lines
// skipped: 2"; only a line-start marker (`edited:`, `skipped:`) is a
// report. Import specifiers come from a lexer, never a regex, so fixture
// strings never count. Corpus counts match the SPEC §4.9.2 sentence shape,
// never bare digit runs. Write targets must look like paths.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";
import { resolveArchPublicEntry } from "../../../src/features/packs/enforcers/arch-guards.ts";
import { resolveDocNoCorpusCounts } from "../../../src/features/packs/enforcers/docs-guards.ts";
import {
	resolveNoNewSuppressions,
	resolveNoSkippedTests,
	resolveTestCommandIntact,
} from "../../../src/features/packs/enforcers/integrity-guards.ts";
import {
	resolveBugRowsImmutable,
	resolveHistoryAppendOnly,
} from "../../../src/features/packs/enforcers/records-guards.ts";
import { resolveTsNoPhantomImport } from "../../../src/features/packs/enforcers/ts-phantom.ts";
import { resolveWorkflowGates } from "../../../src/features/packs/enforcers/workflow-guards.ts";
import { resolveWriteConfinement } from "../../../src/features/packs/enforcers/write-confine.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import type { PackRule, Result } from "../../../src/kernel/index.ts";
import { err, makeError } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function ruleFor(id: string): PackRule {
	return {
		id,
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "test-enforcer",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
}

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

async function findingsOf(
	resolve: (
		decl: EnforcerDecl,
		rule: PackRule,
		ports: ReturnType<typeof createFakePorts>["ports"],
	) => Result<Enforcer>,
	ruleId: string,
	files: Readonly<Record<string, string>>,
): Promise<number> {
	const { ports, fs } = createFakePorts();
	for (const [path, text] of Object.entries(files)) {
		fs.seedText(path, text);
	}
	const resolved = resolve(
		{ id: "test-enforcer", kind: "code", budgetMs: 1000 },
		ruleFor(ruleId),
		ports,
	);
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		return -1;
	}
	const findings = await resolved.value.check(ctxFor(Object.keys(files)), {});
	return findings.filter((finding) => finding.ruleId === ruleId).length;
}

test("[§5.9] workflow gates match report lines not status strings", async () => {
	const midLine = await findingsOf(
		resolveWorkflowGates,
		"core/workflow-gates",
		{
			"src/a.ts": 'const status = "corrupt lines skipped: 2";\n',
		},
	);
	assert.equal(midLine, 0);
	const report = await findingsOf(resolveWorkflowGates, "core/workflow-gates", {
		"sample.txt": "path: src/a.ts\nskipped: review\n",
	});
	assert.equal(report, 1);
});

test("[§5.8] history append matches report lines not code strings", async () => {
	const midLine = await findingsOf(
		resolveHistoryAppendOnly,
		"core/history-append-only",
		{ "src/a.ts": 'log("edited: by hand");\n' },
	);
	assert.equal(midLine, 0);
	const report = await findingsOf(
		resolveHistoryAppendOnly,
		"core/history-append-only",
		{ "sample.txt": "path: docs/HISTORY/2026-10.md\nedited: yes\n" },
	);
	assert.equal(report, 1);
});

test("[§5.8] bug rows immutable matches report lines not code strings", async () => {
	const midLine = await findingsOf(
		resolveBugRowsImmutable,
		"core/bug-rows-immutable",
		{ "src/a.ts": 'log("edited: by hand");\n' },
	);
	assert.equal(midLine, 0);
	const report = await findingsOf(
		resolveBugRowsImmutable,
		"core/bug-rows-immutable",
		{ "sample.txt": "bug-row: BUG-0001\nedited: yes\n" },
	);
	assert.equal(report, 1);
});

test("[§4.7.3] write confinement ignores code shaped targets", async () => {
	// FakeFs.realpath resolves every spelling; the real port fails on
	// missing paths, which is how a code-shaped target becomes a
	// could-not-resolve finding. Gate realpath on existence here.
	class StrictFs extends FakeFs {
		override realpath(path: string): ReturnType<FakeFs["realpath"]> {
			return super.exists(path).then((seen) => {
				if (seen.ok && seen.value) {
					return super.realpath(path);
				}
				return err(
					makeError("CDX-E301", `no such file: ${path}`, "seed the path"),
				);
			});
		}
	}
	async function confinedFindings(
		files: Readonly<Record<string, string>>,
	): Promise<number> {
		const strict = new StrictFs();
		for (const [path, text] of Object.entries(files)) {
			strict.seedText(path, text);
		}
		const { ports } = createFakePorts();
		const strictPorts = { ...ports, fs: strict };
		const resolved = resolveWriteConfinement(
			DECL,
			ruleFor("core/write-confinement"),
			strictPorts,
		);
		const findings = await resolved.value.check(ctxFor(Object.keys(files)));
		return findings.filter(
			(finding) => finding.ruleId === "core/write-confinement",
		).length;
	}
	const objectField = await confinedFindings({
		"src/a.ts": 'const caps = {\n\twrite: "write",\n};\n',
	});
	assert.equal(objectField, 0);
	const signature = await confinedFindings({
		"src/a.ts": "write: (chunk: string) => boolean;\n",
	});
	assert.equal(signature, 0);
});

test("[§6.1] phantom imports ignore fixture strings", async () => {
	const fixtureString = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": "const s = 'import x from \"nope\";';\n" },
	);
	assert.equal(fixtureString, 0);
	const realPhantom = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": 'import x from "nope";\n' },
	);
	assert.equal(realPhantom, 1);
	const relative = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": 'import x from "./nope";\nimport y from "node:fs";\n' },
	);
	assert.equal(relative, 0);
	const required = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": 'const x = require("nope");\n' },
	);
	assert.equal(required, 1);
	const dynamic = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": "const x = await import(name);\n" },
	);
	assert.equal(dynamic, 0);
	const equals = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": 'import x = require("nope");\n' },
	);
	assert.equal(equals, 1);
	const meta = await findingsOf(
		resolveTsNoPhantomImport,
		"ts/no-phantom-import",
		{ "src/a.ts": "const url = import.meta.url;\n" },
	);
	assert.equal(meta, 0);
});

test("[§4.9.2] corpus counts match the SPEC sentence shape", async () => {
	const shaped = await findingsOf(
		resolveDocNoCorpusCounts,
		"core/doc-no-corpus-counts",
		{ "docs/a.md": "The repository has 1,234 rules.\n" },
	);
	assert.equal(shaped, 1);
	const validation = await findingsOf(
		resolveDocNoCorpusCounts,
		"core/doc-no-corpus-counts",
		{ "docs/a.md": "coverage 90.06 lines / 84.21 branches.\n" },
	);
	assert.equal(validation, 0);
	const citation = await findingsOf(
		resolveDocNoCorpusCounts,
		"core/doc-no-corpus-counts",
		{ "docs/a.md": "See SPEC §5.6 defaults: 10 files, 300 lines.\n" },
	);
	assert.equal(citation, 0);
});

test("[§5.7] public entry matches import markers not prose", async () => {
	const prose = await findingsOf(
		resolveArchPublicEntry,
		"core/arch-public-entry",
		{ "docs/a.md": "Tests may import internals of their own module.\n" },
	);
	assert.equal(prose, 0);
	const deep = await findingsOf(
		resolveArchPublicEntry,
		"core/arch-public-entry",
		{ "sample.txt": "import: engine/internals.js\n" },
	);
	assert.equal(deep, 1);
	const shallow = await findingsOf(
		resolveArchPublicEntry,
		"core/arch-public-entry",
		{ "sample.txt": "import: engine/index.js\n" },
	);
	assert.equal(shallow, 0);
});

test("[§5.5] skipped tests ignore fixture strings", async () => {
	const vector = await findingsOf(
		resolveNoSkippedTests,
		"core/no-skipped-tests",
		{ "src/a.test.ts": "const v = \"test.skip('b', () => {});\";\n" },
	);
	assert.equal(vector, 0);
	const skipped = await findingsOf(
		resolveNoSkippedTests,
		"core/no-skipped-tests",
		{ "src/a.test.ts": 'test.skip("b", () => {});\n' },
	);
	assert.equal(skipped, 1);
});

test("[§5.5] suppressions match added markers not prose", async () => {
	const prose = await findingsOf(
		resolveNoNewSuppressions,
		"core/no-new-suppressions",
		{ "docs/a.md": "Suppressions like `biome-ignore` stay banned.\n" },
	);
	assert.equal(prose, 0);
	const added = await findingsOf(
		resolveNoNewSuppressions,
		"core/no-new-suppressions",
		{ "sample.txt": "added: eslint-disable-next-line\n" },
	);
	assert.equal(added, 1);
	const none = await findingsOf(
		resolveNoNewSuppressions,
		"core/no-new-suppressions",
		{ "sample.txt": "added: none\n" },
	);
	assert.equal(none, 0);
});

test("[§5.5] test commands match test markers not prose", async () => {
	const prose = await findingsOf(
		resolveTestCommandIntact,
		"core/test-command-intact",
		{ "docs/a.md": "Never weaken the command with `|| true`.\n" },
	);
	assert.equal(prose, 0);
	const narrowed = await findingsOf(
		resolveTestCommandIntact,
		"core/test-command-intact",
		{ "sample.txt": "test: node --test one-file.ts\n" },
	);
	assert.equal(narrowed, 1);
	const intact = await findingsOf(
		resolveTestCommandIntact,
		"core/test-command-intact",
		{ "sample.txt": "test: npm test\n" },
	);
	assert.equal(intact, 0);
});
