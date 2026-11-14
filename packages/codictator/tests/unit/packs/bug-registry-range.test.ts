// SPEC §4.9.4 core/bug-registry + BUG-0098: a range may hold several history
// entries (a fix and a docs change); each fix task is judged by its OWN entry
// (matched on its Task id, newest file first), never by whichever entry
// happens to be first. A fix task whose own entry lacks a Bug row still fails
// closed; the newest entry stands in only when no entry names the task.
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveBugRegistry } from "../../../src/features/packs/enforcers/records-guards.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import type { PackRule } from "../../../src/kernel/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const NL = String.fromCharCode(10);
const REGRESSION = "tests/a.test.ts";
const BUGS = [
	"# Bugs — 2026",
	"",
	"| Id | Status | Title | Found | Fix | Regression test |",
	"|---|---|---|---|---|---|",
	`| BUG-0001 | fixed | [§1] a defect | 2026-11-14, T-0001 | T-0001, fix(x): y | ${REGRESSION} |`,
	"",
].join(NL);

function entry(
	subject: string,
	task: string,
	kind: string,
	bug?: string,
): string {
	return [
		`## 2026-11-14 · ${subject}`,
		`- **Kind:** ${kind}`,
		`- **Task:** ${task}`,
		...(bug === undefined ? [] : [`- **Bug:** ${bug}`]),
		"- **Why:** reason",
		"- **What went wrong:** nothing",
		"- **Trade-offs:** none",
		"- **Lessons:** learned",
		"",
	].join(NL);
}

function title(date: string): string {
	return `# History — ${date}${NL}${NL}`;
}

function ruleFor(): PackRule {
	return {
		id: "core/bug-registry",
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "test-enforcer",
		triggers: ["review"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

async function bugFindings(
	histories: Readonly<Record<string, string>>,
): Promise<Array<string>> {
	const fs = new FakeFs();
	const task: TaskRecord = {
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a thing",
		branch: "fix/a",
		phase: "integrate",
		phases: [],
		spec: ["docs/SPEC/04-12-WORKFLOW.md"],
		acceptanceCriteria: ["judged as planned"],
		diagnosis: "root cause named",
		files: { allow: ["src/**"] },
	};
	fs.seedText(".codictator/tasks/T-0001.json", `${stableStringify(task)}${NL}`);
	fs.seedText("docs/BUGS/2026.md", BUGS);
	fs.seedText(REGRESSION, "// test");
	for (const [file, text] of Object.entries(histories)) {
		fs.seedText(file, text);
	}
	const resolved = resolveBugRegistry(
		{ id: "test-enforcer", kind: "code", budgetMs: 1000 } as EnforcerDecl,
		ruleFor(),
		{ ...createFakePorts().ports, fs },
	);
	assert.ok(resolved.ok);
	const found = await resolved.value.check(
		{
			trigger: "review",
			scope: {
				files: [
					".codictator/tasks/T-0001.json",
					"docs/BUGS/2026.md",
					...Object.keys(histories),
				],
			},
			now: FIXED_INSTANT,
			configHash: "test-hash",
		},
		{},
	);
	return found
		.filter((finding) => finding.ruleId === "core/bug-registry")
		.map((finding) => finding.message);
}

const FIX_ENTRY = entry("fix(x): y", "T-0001", "code", "BUG-0001");
const DOCS_ENTRY = entry("docs: z", "T-0002", "docs");

test("[§4.9.4] bug-registry judges a fix task by its own entry when a newer docs entry has no Bug row (BUG-0098)", async () => {
	const text = title("2026-11-14") + DOCS_ENTRY + NL + FIX_ENTRY;
	assert.deepEqual(
		await bugFindings({ "docs/HISTORY/2026-11-14.md": text }),
		[],
	);
});

test("[§4.9.4] bug-registry reads the newest history file first when a range spans two (BUG-0098)", async () => {
	const older = title("2026-11-13") + DOCS_ENTRY;
	const newer = title("2026-11-14") + FIX_ENTRY;
	assert.deepEqual(
		await bugFindings({
			"docs/HISTORY/2026-11-13.md": older,
			"docs/HISTORY/2026-11-14.md": newer,
		}),
		[],
	);
});

test("[§4.9.4] bug-registry still fails closed when the fix task's own entry has no Bug row", async () => {
	const own = entry("fix(x): y", "T-0001", "code");
	const text = title("2026-11-14") + DOCS_ENTRY + NL + own;
	const found = await bugFindings({ "docs/HISTORY/2026-11-14.md": text });
	assert.ok(found.some((message) => message.includes("names no bug row")));
});

test("[§4.9.4] bug-registry does not borrow another task's Bug row for a fix task", async () => {
	const other = entry("fix(x): other", "T-0009", "code", "BUG-0001");
	const own = entry("fix(x): y", "T-0001", "code");
	const text = title("2026-11-14") + other + NL + own;
	const found = await bugFindings({ "docs/HISTORY/2026-11-14.md": text });
	assert.ok(found.some((message) => message.includes("names no bug row")));
});

test("[§4.9.4] bug-registry falls back to the newest entry when no entry names the task", async () => {
	const text =
		title("2026-11-14") + entry("fix(x): y", "T-0077", "code", "BUG-0001");
	assert.deepEqual(
		await bugFindings({ "docs/HISTORY/2026-11-14.md": text }),
		[],
	);
});
