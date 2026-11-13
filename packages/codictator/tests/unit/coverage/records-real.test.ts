// SPEC §5.8 F15: real-scope bug registry and diagnosis judge fix tasks.
// A fix in implementation names a registry row and carries its diagnosis;
// the task record, not the marker report, decides the verdict.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";
import {
	resolveBugRegistry,
	resolveDiagnoseBeforeFix,
} from "../../../src/features/packs/enforcers/records-guards.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import type { PackRule, Ports, Result } from "../../../src/kernel/index.ts";
import { activeTaskPorts } from "../../support/active-task-ports.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";

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

const BUGS_HEAD =
	"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|";
const BUGS_FIXED =
	"| BUG-0002 | fixed | second defect | 2026-10-02, none | T-0002, fix it | tests/unit/x.test.ts |";

const HISTORY_HEAD = "# History — 2026-10-05";
const HISTORY_ENTRY =
	"## 2026-10-05 · feature: do a thing\n\n- **Kind:** fix\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** flaw\n- **Trade-offs:** none\n- **Lessons:** learned";

function taskJson(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a defect",
		branch: "fix/x",
		phase: "implementation",
		phases: [],
		spec: [],
		acceptanceCriteria: ["fixed"],
		files: { allow: ["src/**", "docs/BUGS/**", "docs/HISTORY/**"] },
		...over,
	});
}

async function findingsOf(
	resolve: (
		decl: EnforcerDecl,
		rule: PackRule,
		ports: Ports,
	) => Result<Enforcer>,
	ruleId: string,
	scope: Readonly<Record<string, string>>,
	tasks: ReadonlyArray<string>,
): Promise<Array<string>> {
	const fs = new FakeFs();
	for (const [file, text] of Object.entries(scope)) {
		fs.seedText(file, text);
	}
	const ports = activeTaskPorts(tasks[0] ?? taskJson(), fs);
	const resolved = resolve(
		{ id: "test-enforcer", kind: "code", budgetMs: 1000 },
		ruleFor(ruleId),
		ports,
	);
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		return [];
	}
	const findings = await resolved.value.check(ctxFor(Object.keys(scope)), {});
	return findings
		.filter((finding) => finding.ruleId === ruleId)
		.map((finding) => finding.message);
}

test("[§5.8] real scope flags a fix without diagnosis", async () => {
	const messages = await findingsOf(
		resolveDiagnoseBeforeFix,
		"core/diagnose-before-fix",
		{ "src/fix.ts": "export const x = 1;\n" },
		[taskJson()],
	);
	assert.equal(messages.length, 1);
	assert.ok(messages[0]?.includes("without diagnosis"));
});

test("[§5.8] real scope stays quiet for a diagnosed fix", async () => {
	const messages = await findingsOf(
		resolveDiagnoseBeforeFix,
		"core/diagnose-before-fix",
		{ "src/fix.ts": "export const x = 1;\n" },
		[taskJson({ diagnosis: "null dereference on empty input" })],
	);
	assert.deepEqual(messages, []);
});

test("[§5.8] real scope stays quiet for a non-fix task", async () => {
	const messages = await findingsOf(
		resolveDiagnoseBeforeFix,
		"core/diagnose-before-fix",
		{ "src/fix.ts": "export const x = 1;\n" },
		[taskJson({ type: "docs", phase: "planning" })],
	);
	assert.deepEqual(messages, []);
});

test("[§5.8] real scope flags a fix naming an unknown bug row", async () => {
	const messages = await findingsOf(
		resolveBugRegistry,
		"core/bug-registry",
		{
			"src/fix.ts": "export const x = 1;\n",
			"docs/BUGS/2026.md": `${BUGS_HEAD}\n${BUGS_FIXED}`,
			"docs/HISTORY/2026-10-05.md": `${HISTORY_HEAD}\n\n${HISTORY_ENTRY}\n\n- **Bug:** BUG-9999`,
		},
		[taskJson()],
	);
	assert.ok(messages.some((message) => message.includes("BUG-9999")));
});

test("[§5.8] real scope stays quiet for a fixed row with a regression test", async () => {
	const messages = await findingsOf(
		resolveBugRegistry,
		"core/bug-registry",
		{
			"src/fix.ts": "export const x = 1;\n",
			"docs/BUGS/2026.md": `${BUGS_HEAD}\n${BUGS_FIXED}`,
			"docs/HISTORY/2026-10-05.md": `${HISTORY_HEAD}\n\n${HISTORY_ENTRY}\n\n- **Bug:** BUG-0002`,
			"tests/unit/x.test.ts": "test('x', () => {});\n",
		},
		[taskJson()],
	);
	assert.deepEqual(messages, []);
});

test("[§5.8] real scope stays quiet when no fix task claims the scope", async () => {
	const messages = await findingsOf(
		resolveBugRegistry,
		"core/bug-registry",
		{ "src/fix.ts": "export const x = 1;\n" },
		[taskJson({ type: "docs", phase: "planning" })],
	);
	assert.deepEqual(messages, []);
});
