// SPEC §10.2: acceptance tests drive the built CLI end to end as a child
// process (shell: false, argv array). runNodeScript spawns any node entry for
// self-tests here; later suites pass the built dist entry via runBuiltCli.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface NodeRunOptions {
	readonly nodeArgs: ReadonlyArray<string>;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly stdin?: string;
	readonly timeoutMs?: number;
}

export interface BuiltCliOptions {
	readonly args?: ReadonlyArray<string>;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly stdin?: string;
	readonly timeoutMs?: number;
}

export interface CliResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
}

export function builtCliPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "dist", "cli", "main.js");
}

export function runNodeScript(options: NodeRunOptions): Promise<CliResult> {
	return new Promise((resolve) => {
		const child = execFile(
			process.execPath,
			[...options.nodeArgs],
			{
				cwd: options.cwd ?? process.cwd(),
				env: { ...process.env, ...options.env },
				timeout: options.timeoutMs ?? 30_000,
				maxBuffer: 10 * 1024 * 1024,
				encoding: "utf8",
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ code: 0, stdout, stderr, timedOut: false });
					return;
				}
				resolve({
					code: typeof error.code === "number" ? error.code : 1,
					stdout,
					stderr,
					timedOut: error.killed === true,
				});
			},
		);
		const input = options.stdin;
		const stdin = child.stdin;
		if (input !== undefined && stdin !== null) {
			stdin.write(input);
			stdin.end();
		}
	});
}

export function runBuiltCli(options: BuiltCliOptions = {}): Promise<CliResult> {
	return runNodeScript({
		nodeArgs: [builtCliPath(), ...(options.args ?? [])],
		cwd: options.cwd ?? process.cwd(),
		env: { ...options.env },
		timeoutMs: options.timeoutMs ?? 30_000,
		...(options.stdin === undefined ? {} : { stdin: options.stdin }),
	});
}
