import { strict as assert } from "node:assert";

import test from "node:test";

import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";

import {
	resolveNoNewSuppressions,
	resolveNoSkippedTests,
	resolveTestCommandIntact,
} from "../../../src/features/packs/enforcers/integrity-guards.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import type { PackRule, Result } from "../../../src/kernel/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

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
