// SPEC §4.12.3 + §4.9.4 + §4.15.2 + §5.11: a live L1 write is judged on the
// evidence and the content it carries, not on markers or the task phase.
// Before the fix the red-proof and diagnosis rules judged only a task past
// planning, and the workflow, file-name and bug-row rules judged only
// fixture marker files, so a real write never reached them (BUG-0105).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding, Scope } from "../../../src/features/engine/index.ts";
import { resolveCiActionsPinned } from "../../../src/features/packs/enforcers/ci-guards.ts";
import {
	resolveBugRowsImmutable,
	resolveDiagnoseBeforeFix,
	resolveFileNaming,
} from "../../../src/features/packs/enforcers/records-guards.ts";
import { resolveRedBeforeGreen } from "../../../src/features/packs/enforcers/testing-guards.ts";
import type { Ports } from "../../../src/kernel/index.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { FakeGit } from "../../support/fake-git.ts";
import { branchPorts, seedActiveTask } from "../../support/l1-task-ports.ts";
import {
	checked,
	ctxFor,
	DECL,
	portsWith,
	readScope,
	ruleFor,
	ruleIds,
	writeScope,
} from "../../support/pre-tool-scenario.ts";

const SOURCE = "export const a = 1;\n";

async function redFindings(
	ports: Ports,
	scope: Scope,
): Promise<Array<Finding>> {
	const enforcer = checked(
		resolveRedBeforeGreen(DECL, ruleFor("core/red-before-green"), ports),
	);
	return enforcer.check(ctxFor(scope), {});
}

function planningPorts(init: {
	readonly type: string;
	readonly redProof?: boolean;
	readonly diagnosis?: string;
}): Ports {
	const fs = new FakeFs();
	seedActiveTask(fs, {
		id: "T-0001",
		branch: "work/x",
		phase: "planning",
		...init,
	});
	return branchPorts(fs, "work/x");
}

test("[§4.12.3] L1 red-before-green blocks a planning source write while no red proof is held", async () => {
	const ports = planningPorts({ type: "feature" });
	assert.ok(
		ruleIds(await redFindings(ports, writeScope("src/a.ts", SOURCE))).includes(
			"core/red-before-green",
		),
	);
});

test("[§4.12.3] L1 red-before-green allows test, doc and read calls and a held proof", async () => {
	const bare = planningPorts({ type: "feature" });
	assert.deepEqual(
		await redFindings(bare, writeScope("tests/a.test.ts", SOURCE)),
		[],
	);
	assert.deepEqual(
		await redFindings(bare, writeScope("docs/NOTE.md", "# n\n")),
		[],
	);
	assert.deepEqual(await redFindings(bare, readScope("src/a.ts")), []);
	const proven = planningPorts({ type: "feature", redProof: true });
	assert.deepEqual(
		await redFindings(proven, writeScope("src/a.ts", SOURCE)),
		[],
	);
});

test("[§4.12.3] L1 diagnose-before-fix blocks a fix-task source write while no diagnosis is held", async () => {
	const check = async (ports: Ports, scope: Scope): Promise<Array<string>> => {
		const enforcer = checked(
			resolveDiagnoseBeforeFix(
				DECL,
				ruleFor("core/diagnose-before-fix"),
				ports,
			),
		);
		return ruleIds(await enforcer.check(ctxFor(scope), {}));
	};
	const write = writeScope("src/a.ts", SOURCE);
	assert.ok(
		(await check(planningPorts({ type: "fix" }), write)).includes(
			"core/diagnose-before-fix",
		),
	);
	assert.deepEqual(
		await check(planningPorts({ type: "fix", diagnosis: "root cause" }), write),
		[],
	);
	assert.deepEqual(
		await check(
			planningPorts({ type: "fix" }),
			writeScope("tests/a.test.ts", SOURCE),
		),
		[],
	);
});

async function ciFindings(content: string): Promise<Array<Finding>> {
	const enforcer = checked(
		resolveCiActionsPinned(
			DECL,
			ruleFor("core/ci-actions-pinned"),
			portsWith(new FakeFs()),
		),
	);
	return enforcer.check(
		ctxFor(writeScope(".github/workflows/probe.yml", content)),
		{},
	);
}

test("[§4.15.2] L1 ci-actions-pinned judges a real workflow write", async () => {
	const unpinned =
		"jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4\n";
	assert.ok(
		ruleIds(await ciFindings(unpinned)).includes("core/ci-actions-pinned"),
	);
	const sha = "a".repeat(40);
	assert.deepEqual(
		await ciFindings(`jobs:\n  x:\n    steps:\n      - uses: a/b@${sha}\n`),
		[],
	);
});

async function nameFindings(path: string): Promise<Array<Finding>> {
	const enforcer = checked(
		resolveFileNaming(
			DECL,
			ruleFor("core/file-naming"),
			portsWith(new FakeFs()),
		),
	);
	return enforcer.check(ctxFor(writeScope(path, SOURCE)), {});
}

test("[§5.11] L1 file-naming judges the real path of a write", async () => {
	assert.ok(
		ruleIds(await nameFindings("src/Bad Name.TS")).includes("core/file-naming"),
	);
	assert.deepEqual(await nameFindings("src/good-name.ts"), []);
	assert.deepEqual(await nameFindings("src/[id].ts"), []);
});

const BUG_HEAD =
	"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n";
const BUG_ROW = "| BUG-0000 | open | Seed row | 2026-11-08, none |  |  |\n";

async function bugFindings(next: string): Promise<Array<Finding>> {
	const git = new FakeGit();
	git.setShow("HEAD", "docs/BUGS/2026.md", `${BUG_HEAD}${BUG_ROW}`);
	const enforcer = checked(
		resolveBugRowsImmutable(
			DECL,
			ruleFor("core/bug-rows-immutable"),
			portsWith(new FakeFs(), git),
		),
	);
	return enforcer.check(
		ctxFor(writeScope("docs/BUGS/2026.md", `${BUG_HEAD}${next}`)),
		{},
	);
}

test("[§4.9.4] L1 bug-rows-immutable judges the proposed registry against HEAD", async () => {
	assert.ok(
		ruleIds(
			await bugFindings(BUG_ROW.replace("Seed row", "Edited title")),
		).includes("core/bug-rows-immutable"),
	);
	assert.ok(ruleIds(await bugFindings("")).includes("core/bug-rows-immutable"));
	assert.deepEqual(await bugFindings(BUG_ROW), []);
	const fixed = BUG_ROW.replace("| open |", "| fixed |").replace(
		"|  |  |",
		"| T-0001, fix(x): y | tests/x.test.ts |",
	);
	assert.deepEqual(await bugFindings(fixed), []);
});
