// Shared fake ports for L1 unit files that judge the active task of a
// branch (SPEC §4.12.3): a scripted `git branch --show-current` plus task
// records seeded on the fake filesystem.
import type { TaskRecord } from "../../src/features/workflow/index.ts";
import type { Ports, ProcResult } from "../../src/kernel/index.ts";
import { stableStringify } from "../../src/kernel/index.ts";
import type { FakeFs } from "./fake-fs.ts";
import { FakeGit } from "./fake-git.ts";
import { createFakePorts } from "./fake-ports.ts";

export const BRANCH_ARGV = ["git", "branch", "--show-current"];

export function branchResult(stdout: string): ProcResult {
	return { code: 0, stdout, stderr: "", timedOut: false, truncated: false };
}

// Ports whose branch lookup answers `branch`; the fake git carries a root so
// the lookup runs.
export function branchPorts(fs: FakeFs, branch: string): Ports {
	const bundle = createFakePorts();
	bundle.proc.when(BRANCH_ARGV, branchResult(`${branch}\n`));
	return { ...bundle.ports, fs, git: new FakeGit() };
}

export function seedActiveTask(
	fs: FakeFs,
	init: {
		readonly id: string;
		readonly branch: string;
		readonly type: string;
		readonly phase: string;
		readonly redProof?: boolean;
		readonly diagnosis?: string;
	},
): void {
	const record = {
		version: 1,
		id: init.id,
		type: init.type,
		title: `task ${init.id}`,
		branch: init.branch,
		phase: init.phase,
		phases: [],
		spec: ["§4.12.3"],
		acceptanceCriteria: ["the write is judged against the branch task"],
		files: { allow: ["src/**", "tests/**"] },
		...(init.diagnosis === undefined ? {} : { diagnosis: init.diagnosis }),
		...(init.redProof === true
			? {
					redProof: {
						commit: "c0ffee",
						tree: "t0ffee",
						failing: ["t"],
						at: "2026-11-21T00:00:00.000Z",
					},
				}
			: {}),
	} as unknown as TaskRecord;
	fs.seedText(
		`.codictator/tasks/${init.id}.json`,
		`${stableStringify(record)}\n`,
	);
}
