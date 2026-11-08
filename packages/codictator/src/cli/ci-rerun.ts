// CI verify re-runs in-range red proofs (SPEC §4.10.2 + §4.12.3 L4): each
// branch-task proof checks out in a detached worktree and re-runs, judged
// by checkRedProofReRun. Unverifiable proofs stay quiet; the gate enforcers
// still judge the range.
import { tmpdir } from "node:os";
import path from "node:path";
import type { Finding } from "../features/engine/index.ts";
import {
	checkRedProofReRun,
	type DeclaredTest,
	type ReRunInput,
} from "../features/testing/proofs.ts";
import { classifyChange } from "../features/workflow/index.ts";
import { readTestReport } from "../kernel/index.ts";
import type { CiRange } from "./ci-range.ts";
import { GIT_OUTPUT_LIMIT, GIT_TIMEOUT, runGitText } from "./git-history.ts";
import type { CommandPorts } from "./shared.ts";
import { listTaskIds, readTask } from "./tasks.ts";

const RERUN_TIMEOUT_MS = 600000;
const RERUN_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

async function runGit(
	ports: CommandPorts,
	argv: ReadonlyArray<string>,
): Promise<string | undefined> {
	const ran = await runGitText(ports, argv);
	if (!ran.ok) {
		return undefined;
	}
	return ran.value;
}

function declaredOf(
	tests: ReadonlyArray<{ readonly path: string; readonly title: string }>,
): Array<DeclaredTest> {
	return tests.map((test) => ({ path: test.path, title: test.title }));
}

// SPEC §10.3 item 3: only kernel touches node:fs, so the worktree dir is a
// pure path computation (node:os/node:path only) and git itself creates and
// removes it through the proc port — never direct fs calls.
function worktreeDir(ports: CommandPorts, commit: string): string {
	const stamp = ports.clock.now().replace(/[^A-Za-z0-9]+/g, "-");
	return path.join(
		tmpdir(),
		`codictator-rerun-${commit.slice(0, 16)}-${stamp}`,
	);
}
async function rerunInWorktree(
	ports: CommandPorts,
	commit: string,
	declared: ReadonlyArray<DeclaredTest>,
	judge: (input: ReRunInput) => Array<Finding>,
): Promise<Array<Finding>> {
	const dir = worktreeDir(ports, commit);
	try {
		// Clear a stale dir from an interrupted run first: remove --force
		// drops a stale worktree registration and deletes the dir, so the
		// add below starts clean. A nonzero result is ignored.
		await ports.proc.run(["git", "worktree", "remove", "--force", dir], {
			cwd: ports.root,
			env: {},
			timeoutMs: GIT_TIMEOUT,
			maxOutputBytes: GIT_OUTPUT_LIMIT,
		});
		const added = await ports.proc.run(
			["git", "worktree", "add", "--detach", dir, commit],
			{
				cwd: ports.root,
				env: {},
				timeoutMs: GIT_TIMEOUT,
				maxOutputBytes: GIT_OUTPUT_LIMIT,
			},
		);
		if (added.timedOut || added.truncated || added.code !== 0) {
			return [];
		}
		const rerun = await ports.proc.run(
			["npm", "test", "--", "--reporter=junit"],
			{
				cwd: dir,
				env: {},
				timeoutMs: RERUN_TIMEOUT_MS,
				maxOutputBytes: RERUN_MAX_OUTPUT_BYTES,
			},
		);
		// SPEC §4.10.2: only a machine-readable report judges the proof; any
		// other output leaves the proof unverifiable (no findings), never a
		// forged pass or a false block.
		const parsed = readTestReport(rerun.stdout);
		if (!parsed.ok || parsed.value.length === 0) {
			return [];
		}
		return judge({ declared, rerunReportXml: rerun.stdout });
	} catch {
		return [];
	} finally {
		// git removes the worktree dir itself; nothing else to clean.
		await ports.proc.run(["git", "worktree", "remove", "--force", dir], {
			cwd: ports.root,
			env: {},
			timeoutMs: GIT_TIMEOUT,
			maxOutputBytes: GIT_OUTPUT_LIMIT,
		});
	}
}

// SPEC §4.12.3 L4: a code-class range with no task record fails
// core/workflow-gates instead of passing silently. Records-only ranges owe
// no task; an unreadable range stays quiet (the trailer gate already fails
// closed on it).
async function noTaskFindings(
	ports: CommandPorts,
	range: CiRange,
): Promise<Array<Finding>> {
	const listed = await runGit(ports, [
		"git",
		"diff",
		"--name-only",
		range.base,
		range.head,
		"--",
	]);
	if (listed === undefined) {
		return [];
	}
	const files = listed
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (files.length === 0 || classifyChange(files) !== "code") {
		return [];
	}
	return [
		{
			ruleId: "core/workflow-gates",
			message: "range has no task record on this branch",
			remediation:
				"Run codictator task new --type <type> --title ... to open the branch task.",
		} satisfies Finding,
	];
}

export async function rerunRedProofs(
	ports: CommandPorts,
	root: string,
	range: CiRange,
	judge: (input: ReRunInput) => Array<Finding> = checkRedProofReRun,
): Promise<Array<Finding>> {
	const ids = await listTaskIds(root);
	if (ids.length === 0) {
		return noTaskFindings(ports, range);
	}
	const byCommit = new Map<string, Array<DeclaredTest>>();
	for (const id of ids) {
		const task = await readTask(root, id);
		const proof = task?.redProof;
		const tests = task?.tests ?? [];
		if (proof === undefined || tests.length === 0) {
			continue;
		}
		const declared = declaredOf(
			tests.filter((test) => proof.failing.includes(test.title)),
		);
		if (declared.length === 0) {
			continue;
		}
		byCommit.set(proof.commit, [
			...(byCommit.get(proof.commit) ?? []),
			...declared,
		]);
	}
	if (byCommit.size === 0) {
		return [];
	}
	const listed = await runGit(ports, [
		"git",
		"log",
		"--format=%H",
		`${range.base}..${range.head}`,
	]);
	if (listed === undefined) {
		return [];
	}
	const inRange = new Set(
		listed
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== ""),
	);
	const headTree = await runGit(ports, [
		"git",
		"rev-parse",
		`${range.head}^{tree}`,
	]);
	const findings: Array<Finding> = [];
	for (const [commit, declared] of byCommit) {
		if (!inRange.has(commit)) {
			continue;
		}
		// Forgery short-circuit: a red proof recorded at the implemented
		// tree is not red. An empty re-run report flags every declared test
		// through the same checker, so the forgery blocks with CDX-E602.
		const proofTree = await runGit(ports, [
			"git",
			"rev-parse",
			`${commit}^{tree}`,
		]);
		if (
			proofTree !== undefined &&
			headTree !== undefined &&
			proofTree.trim() !== "" &&
			proofTree.trim() === headTree.trim()
		) {
			findings.push(...judge({ declared, rerunReportXml: "" }));
			continue;
		}
		findings.push(...(await rerunInWorktree(ports, commit, declared, judge)));
	}
	return findings;
}
