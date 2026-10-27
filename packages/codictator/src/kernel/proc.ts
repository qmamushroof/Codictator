// SPEC §4.1.1 and §9.2: the real Proc port. argv arrays only, shell:false
// always, the child env built from the §9.2 allowlist (plus a tool's envPass
// restricted to that allowlist, GITHUB_* only when CI is set). Output past
// maxOutputBytes kills the tree and returns truncated:true; a timeout kills
// the process tree (SIGTERM, then SIGKILL or taskkill /T /F within 1 s) and
// returns timedOut:true.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type { Proc, ProcOptions, ProcResult } from "./index.ts";

// SPEC §9.2: the only names a child process may inherit or receive.
export const PROC_ENV_ALLOWLIST: ReadonlyArray<string> = [
	"CI",
	"HOME",
	"LANG",
	"LC_ALL",
	"PATH",
	"SystemRoot",
	"TEMP",
	"TMP",
	"TMPDIR",
	"USERPROFILE",
];

function takeEnv(
	into: Record<string, string>,
	name: string,
	value: string | undefined,
): void {
	if (value !== undefined) {
		into[name] = value;
	}
}

export function buildProcEnv(
	requested: Readonly<Record<string, string>>,
): Record<string, string> {
	const child: Record<string, string> = {};
	const { CI: requestedCI } = requested;
	const { CI: ambientCI } = process.env;
	const ciActive = (requestedCI ?? ambientCI ?? "") !== "";
	for (const name of PROC_ENV_ALLOWLIST) {
		takeEnv(child, name, requested[name] ?? process.env[name]);
	}
	if (ciActive) {
		for (const [name, value] of Object.entries(process.env)) {
			if (name.startsWith("GITHUB_")) {
				takeEnv(child, name, value);
			}
		}
		for (const [name, value] of Object.entries(requested)) {
			if (name.startsWith("GITHUB_")) {
				takeEnv(child, name, value);
			}
		}
	}
	return child;
}

const KILL_GRACE_MS = 500;

interface RunState {
	readonly out: Array<Buffer>;
	readonly err: Array<Buffer>;
	keptBytes: number;
	truncated: boolean;
	timedOut: boolean;
	settled: boolean;
	timer: ReturnType<typeof setTimeout> | undefined;
	grace: ReturnType<typeof setTimeout> | undefined;
}

function signalOne(pid: number, signal: NodeJS.Signals): boolean {
	try {
		process.kill(pid, signal);
		return true;
	} catch {
		return false;
	}
}

// SPEC §4.1.3 EC-6: the tree dies within 1 s even when the child ignores
// SIGTERM. POSIX kills the process group (SIGTERM, then SIGKILL after the
// grace); Windows has no SIGTERM semantics, so the first action is already
// taskkill /T /F, repeated on escalation to catch late grandchildren.
function killTree(pid: number | undefined, escalate: boolean): void {
	if (pid === undefined) {
		return;
	}
	try {
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
				stdio: "ignore",
			});
			return;
		}
		if (escalate) {
			if (!signalOne(-pid, "SIGKILL")) {
				signalOne(pid, "SIGKILL");
			}
			return;
		}
		if (!signalOne(-pid, "SIGTERM")) {
			signalOne(pid, "SIGTERM");
		}
	} catch {
		return;
	}
}

function pushChunk(
	state: RunState,
	store: Array<Buffer>,
	chunk: Buffer,
	max: number,
	kill: () => void,
): void {
	if (state.keptBytes >= max) {
		return;
	}
	const room = max - state.keptBytes;
	if (chunk.length <= room) {
		store.push(chunk);
		state.keptBytes += chunk.length;
		return;
	}
	store.push(chunk.subarray(0, room));
	state.keptBytes += room;
	state.truncated = true;
	kill();
}

function clearRunTimers(state: RunState): void {
	if (state.timer !== undefined) {
		clearTimeout(state.timer);
		state.timer = undefined;
	}
	if (state.grace !== undefined) {
		clearTimeout(state.grace);
		state.grace = undefined;
	}
}

function makeRunState(): RunState {
	return {
		out: [],
		err: [],
		keptBytes: 0,
		truncated: false,
		timedOut: false,
		settled: false,
		timer: undefined,
		grace: undefined,
	};
}

function armTimeout(
	state: RunState,
	timeoutMs: number,
	onTimeout: () => void,
): void {
	state.timer = setTimeout(() => {
		state.timedOut = true;
		onTimeout();
	}, timeoutMs);
}

function wireOutput(
	child: ChildProcess,
	state: RunState,
	maxOutputBytes: number,
	ensureDead: () => void,
): void {
	child.stdout?.on("data", (chunk: Buffer) => {
		pushChunk(state, state.out, chunk, maxOutputBytes, ensureDead);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		pushChunk(state, state.err, chunk, maxOutputBytes, ensureDead);
	});
}

function wireCompletion(
	child: ChildProcess,
	finish: (code: number) => void,
): void {
	child.on("error", () => {
		finish(-1);
	});
	child.on("close", (code) => {
		finish(code ?? -1);
	});
}

function feedStdin(child: ChildProcess, stdin: string | undefined): void {
	if (stdin === undefined) {
		child.stdin?.end();
		return;
	}
	child.stdin?.on("error", () => {
		child.stdin?.destroy();
	});
	child.stdin?.write(stdin, () => {
		child.stdin?.end();
	});
}

function runNodeProcess(
	file: string,
	args: ReadonlyArray<string>,
	options: ProcOptions,
): Promise<ProcResult> {
	return new Promise((resolve) => {
		const state = makeRunState();
		const finish = (code: number): void => {
			if (state.settled) {
				return;
			}
			state.settled = true;
			clearRunTimers(state);
			resolve({
				code,
				stdout: Buffer.concat(state.out).toString("utf8"),
				stderr: Buffer.concat(state.err).toString("utf8"),
				timedOut: state.timedOut,
				truncated: state.truncated,
			});
		};
		// SPEC §4.1.1: argv array only, shell:false; detached on POSIX so the
		// timeout kill reaches the whole process group (EC-6).
		const child: ChildProcess = spawn(file, [...args], {
			cwd: options.cwd,
			env: buildProcEnv(options.env),
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		const ensureDead = (): void => {
			killTree(child.pid, false);
			if (state.grace === undefined) {
				state.grace = setTimeout(() => {
					killTree(child.pid, true);
				}, KILL_GRACE_MS);
			}
		};
		armTimeout(state, options.timeoutMs, ensureDead);
		wireOutput(child, state, options.maxOutputBytes, ensureDead);
		wireCompletion(child, finish);
		feedStdin(child, options.stdin);
	});
}

export class NodeProc implements Proc {
	run(argv: ReadonlyArray<string>, options: ProcOptions): Promise<ProcResult> {
		const [file, ...args] = argv;
		if (file === undefined) {
			throw new Error("proc argv must list an executable first");
		}
		return runNodeProcess(file, args, options);
	}
}
