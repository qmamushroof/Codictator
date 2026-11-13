// Fake ports on a readable branch whose seeded task is the active task
// (SPEC §4.12.1): the task-judging gates judge the branch's active task, so
// a real-scope fixture binds its task to the branch instead of relying on a
// files.allow claim.
import type { Ports } from "../../src/kernel/index.ts";
import { FakeFs } from "./fake-fs.ts";
import { FakeGit } from "./fake-git.ts";
import { createFakePorts } from "./fake-ports.ts";

export function portsOnBranch(fs: FakeFs, branch: string): Ports {
	const bundle = createFakePorts();
	bundle.proc.when(["git", "branch", "--show-current"], {
		code: 0,
		stdout: `${branch}\n`,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	return { ...bundle.ports, fs, git: new FakeGit() };
}

// Seeds task record T-0001 and binds the ports to its branch.
export function activeTaskPorts(
	task: string,
	fs: FakeFs = new FakeFs(),
): Ports {
	fs.seedText(".codictator/tasks/T-0001.json", task);
	const branch = (JSON.parse(task) as { readonly branch?: string }).branch;
	return portsOnBranch(fs, branch ?? "");
}
