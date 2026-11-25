import { strict as assert } from "node:assert";

import test from "node:test";

import { readTask } from "../../../src/cli/tasks.ts";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
}

function recordFor(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a thing",
		branch: "fix/thing",
		phase: "record",
		phases: [],
		spec: ["§4.12"],
		acceptanceCriteria: ["fixed"],
		files: { allow: [] },
		...overrides,
	};
}

const BUG_OPEN =
	"| BUG-0001 | open | [§4.12] a defect | 2026-11-25, T-0001 |  |  |";
const BUG_FIXED =
	"| BUG-0001 | fixed | [§4.12] a defect | 2026-11-25, T-0001 | T-0002, fix(x): y | tests/a.test.ts |";
const BUG_FILE = "docs/BUGS/2026-7.md";
const HISTORY_FILE = "docs/HISTORY/2026-11-25.md";

function bugsDoc(row: string): string {
	return `# Bugs\n\n| ID | Status |\n|---|---|\n${row}\n`;
}

function historyDoc(bug: string | undefined): string {
	const bugLine = bug === undefined ? "" : `- **Bug:** ${bug}\n`;
	return `# History\n\n## 2026-11-25 · fix(x): y\n- **Kind:** fix\n${bugLine}- **Why:** because\n`;
}

// A repo with the bug row open on main and a task branch in record phase.
function recordRepo(): TempRepo {
	const repo = createTempRepo({
		"README.md": "hi",
		[BUG_FILE]: bugsDoc(BUG_OPEN),
	});
	repo.git(["checkout", "-b", "fix/thing"]);
	repo.writeFile(
		".codictator/tasks/T-0001.json",
		`${JSON.stringify(recordFor())}\n`,
	);
	return repo;
}

async function advance(repo: TempRepo): Promise<CliResult> {
	return cli(["task", "phase", "next", "--id", "T-0001"], repo.dir);
}

test("[§4.12.2] record observes the staged history entry", async () => {
	// SPEC §4.12.2 row 6: a staged docs/HISTORY entry is observed by
	// `task phase next` itself; no self-declared flag is needed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.git(["checkout", "-b", "feat/thing"]);
		repo.writeFile(
			".codictator/tasks/T-0001.json",
			`${JSON.stringify(recordFor({ type: "feature", branch: "feat/thing" }))}\n`,
		);
		const blocked = await advance(repo);
		assert.equal(blocked.code, 1);
		assert.ok(blocked.stdout.includes("staged history entry"));
		repo.writeFile(HISTORY_FILE, historyDoc(undefined));
		const moved = await advance(repo);
		assert.equal(moved.code, 0, moved.stdout);
		assert.ok(moved.stdout.includes("task T-0001 entered integrate"));
		const task = await readTask(repo.dir, "T-0001");
		assert.equal(task?.phase, "integrate");
		assert.equal(task?.historyStaged, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.2] record observes the bug row open at the base and fixed in the index", async () => {
	// SPEC §4.12.2 row 6 and the sentence under the table: the entry's Bug:
	// row read `open` at the merge base and reads `fixed` in the index; the
	// change may be committed on the branch or only staged.
	const staged = recordRepo();
	try {
		staged.writeFile(HISTORY_FILE, historyDoc("BUG-0001"));
		staged.writeFile(BUG_FILE, bugsDoc(BUG_FIXED));
		const moved = await advance(staged);
		assert.equal(moved.code, 0, moved.stdout);
		const task = await readTask(staged.dir, "T-0001");
		assert.equal(task?.historyStaged, true);
		assert.equal(task?.bugRowUpdated, true);
	} finally {
		staged.cleanup();
	}
	const committed = recordRepo();
	try {
		committed.writeFile(BUG_FILE, bugsDoc(BUG_FIXED));
		committed.commit("docs(bugs): fix the row");
		committed.writeFile(HISTORY_FILE, historyDoc("BUG-0001"));
		const moved = await advance(committed);
		assert.equal(moved.code, 0, moved.stdout);
		const task = await readTask(committed.dir, "T-0001");
		assert.equal(task?.bugRowUpdated, true);
	} finally {
		committed.cleanup();
	}
});

test("[§4.12.2] record reports missing evidence with remediation naming each item", async () => {
	// SPEC §4.12.2: CDX-E604 names each missing item and how to supply it.
	const repo = recordRepo();
	try {
		const none = await advance(repo);
		assert.equal(none.code, 1);
		assert.ok(
			none.stdout.includes("CDX-E604") ||
				none.stdout.includes("core/workflow-gates"),
		);
		assert.ok(none.stdout.includes("staged history entry"));
		assert.ok(none.stdout.includes("bug row update"));
		assert.ok(none.stdout.includes("docs/HISTORY"));
		assert.ok(none.stdout.includes("Bug:"));
		assert.ok(none.stdout.includes("open to fixed"));
		assert.ok(!none.stdout.includes("Run codictator task phase next to list"));
		// The entry is staged but the row is still open at the index.
		repo.writeFile(HISTORY_FILE, historyDoc("BUG-0001"));
		const rowOpen = await advance(repo);
		assert.equal(rowOpen.code, 1);
		assert.ok(!rowOpen.stdout.includes("staged history entry"));
		assert.ok(rowOpen.stdout.includes("bug row update"));
		assert.ok(rowOpen.stdout.includes("open to fixed"));
		const task = await readTask(repo.dir, "T-0001");
		assert.notEqual(task?.phase, "integrate");
	} finally {
		repo.cleanup();
	}
});
