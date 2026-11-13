// SPEC §4.12.1/§4.12.3: the task-judging gates judge the branch's active
// task plus the tasks whose record the judged change touches. A task whose
// files.allow only matches a changed file is not judged, so a finished or
// parallel task never blocks another task's change (BUG-0075).
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";
import { resolveBugRegistry } from "../../../src/features/packs/enforcers/records-guards.ts";
import { readJudgedTasks } from "../../../src/features/packs/enforcers/scope-tasks.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import type { PackRule, Ports, Result } from "../../../src/kernel/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { portsOnBranch } from "../../support/active-task-ports.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

// No git root: the branch is unreadable, as in a detached CI checkout.
function noBranch(fs: FakeFs): Ports {
	return { ...createFakePorts().ports, fs };
}

function seedTask(
	fs: FakeFs,
	id: string,
	over: Partial<Omit<TaskRecord, "version" | "id">>,
): void {
	const record: TaskRecord = {
		version: 1,
		id,
		type: "fix",
		title: `task ${id}`,
		branch: "fix/a",
		phase: "integrate",
		phases: [],
		spec: ["docs/SPEC/04-12-WORKFLOW.md"],
		acceptanceCriteria: ["judged as planned"],
		files: { allow: ["src/**", "docs/HISTORY/**", "docs/BUGS/**"] },
		...over,
	};
	fs.seedText(`.codictator/tasks/${id}.json`, `${stableStringify(record)}\n`);
}

function idsOf(tasks: ReadonlyArray<TaskRecord>): Array<string> {
	return tasks.map((task) => task.id);
}

test("[§4.12.1] judged tasks skip a task that only claims a changed file", async () => {
	const fs = new FakeFs();
	seedTask(fs, "T-0001", { branch: "fix/a" });
	seedTask(fs, "T-0002", { branch: "feature/b", type: "feature" });
	const judged = await readJudgedTasks(portsOnBranch(fs, "feature/b"), [
		"src/shared.ts",
	]);
	assert.deepEqual(idsOf(judged), ["T-0002"]);
});

test("[§4.12.3] judged tasks include a task whose record the change touches", async () => {
	const fs = new FakeFs();
	seedTask(fs, "T-0001", { branch: "fix/a" });
	seedTask(fs, "T-0002", { branch: "feature/b", type: "feature" });
	const judged = await readJudgedTasks(noBranch(fs), [
		"src/shared.ts",
		".codictator/tasks/T-0002.json",
	]);
	assert.deepEqual(idsOf(judged), ["T-0002"]);
});

function ruleFor(id: string): PackRule {
	return {
		id,
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

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "review",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
}

const HISTORY =
	"# History — 2026-11-09\n\n## 2026-11-09 · docs: explain a thing\n- **Kind:** docs\n- **Task:** T-0002\n- **Why:** reason\n- **What went wrong:** nothing\n- **Trade-offs:** none\n- **Lessons:** learned\n";

test("[§4.9.4] bug-registry ignores a finished fix task that only claims the staged history file", async () => {
	const fs = new FakeFs();
	seedTask(fs, "T-0001", {
		branch: "fix/a",
		diagnosis: "an earlier defect, already landed",
	});
	seedTask(fs, "T-0002", { branch: "docs/b", type: "docs", phase: "record" });
	fs.seedText("docs/HISTORY/2026-11-09.md", HISTORY);
	const resolved: Result<Enforcer> = resolveBugRegistry(
		{ id: "test-enforcer", kind: "code", budgetMs: 1000 } as EnforcerDecl,
		ruleFor("core/bug-registry"),
		portsOnBranch(fs, "docs/b"),
	);
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		return;
	}
	const findings = await resolved.value.check(
		ctxFor(["docs/HISTORY/2026-11-09.md"]),
		{},
	);
	assert.deepEqual(
		findings
			.filter((finding) => finding.ruleId === "core/bug-registry")
			.map((finding) => finding.message),
		[],
	);
});
