// SPEC §7.15 + §4.19.5: the stdio `run` method. It executes CLI commands
// under the same rules and answers the CLI result. A human-only command is
// answered with CDX-E107 and the exact command line in data.commandLine,
// and is never executed, so the extension can open a terminal for the
// human (PRD §12 #22). Command output is captured per call, so frames stay
// the only stdout bytes (EC-9 framing isolation).
import type { Result } from "../kernel/index.ts";
import type { CliOptions } from "./index.ts";
import { invalidParamsError, serverError } from "./serve-protocol.ts";
import { field, isRecord, type MethodOutcome } from "./serve-shared.ts";
import { exitFor } from "./shared.ts";

export interface RunContext {
	readonly root: string;
	readonly execute: (options: CliOptions) => Promise<Result<number>>;
}

// SPEC §4.19.2 H rows: commands (and subcommands) the human-only change
// path reserves. The table keeps the predicate flat; the server refuses
// these before invoking anything.
const ALWAYS_HUMAN: ReadonlySet<string> = new Set([
	"init",
	"uninstall",
	"waive",
]);

const HUMAN_SUBCOMMANDS: ReadonlyArray<readonly [string, string]> = [
	["baseline", "capture"],
	["pack", "accept"],
	["task", "ack"],
];

function isHumanOnly(argv: ReadonlyArray<string>): boolean {
	const command = argv[0] ?? "";
	if (ALWAYS_HUMAN.has(command)) {
		return true;
	}
	const sub = argv[1] ?? "";
	return HUMAN_SUBCOMMANDS.some(
		([name, gated]) => name === command && gated === sub,
	);
}

function commandLine(argv: ReadonlyArray<string>): string {
	return `codictator ${argv.join(" ")}`;
}

type WriteCallback = (error?: Error) => void;

// The CLI handlers print through process.stdout/stderr, so `run` captures
// those process-global writes per call and restores them in a finally. The
// scope is the process, not the connection: frames stay the only stdout
// bytes while one connection serves (each server serializes requests on
// its pump chain), but overlapping `run` calls in one process would share
// the globals. Same-process concurrency therefore stays sequential by
// construction; true parallelism stays across OS processes, one server per
// VS Code window (SPEC §4.19.6 EC-10).
async function executeCaptured(
	ctx: RunContext,
	argv: ReadonlyArray<string>,
): Promise<{
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly code?: string;
	readonly remediation?: string;
}> {
	let stdout = "";
	let stderr = "";
	const originalStdout = process.stdout.write;
	const originalStderr = process.stderr.write;
	const collectStdout = (
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	): boolean => {
		if (typeof chunk === "string") {
			stdout += chunk;
		} else {
			stdout += new TextDecoder().decode(chunk);
		}
		if (typeof encoding === "function") {
			encoding();
		} else if (typeof callback === "function") {
			callback();
		}
		return true;
	};
	const collectStderr = (
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	): boolean => {
		if (typeof chunk === "string") {
			stderr += chunk;
		} else {
			stderr += new TextDecoder().decode(chunk);
		}
		if (typeof encoding === "function") {
			encoding();
		} else if (typeof callback === "function") {
			callback();
		}
		return true;
	};
	process.stdout.write = collectStdout;
	process.stderr.write = collectStderr;
	try {
		const result = await ctx.execute({ argv: [...argv], cwd: ctx.root });
		if (result.ok) {
			return { exitCode: result.value, stdout, stderr };
		}
		return {
			exitCode: exitFor(result.error.code),
			stdout,
			stderr,
			code: result.error.code,
			remediation: result.error.remediation,
		};
	} catch {
		return {
			exitCode: 7,
			stdout,
			stderr,
			code: "CDX-E901",
			remediation: "Retry the command; if it keeps failing, report the stall.",
		};
	} finally {
		process.stdout.write = originalStdout;
		process.stderr.write = originalStderr;
	}
}

// SPEC §7.15: `run { argv }` answers the CLI result; human-only argv
// answers CDX-E107 with data.commandLine and never runs.
export async function handleRun(
	params: unknown,
	ctx: RunContext,
): Promise<MethodOutcome> {
	if (!isRecord(params)) {
		return {
			ok: false,
			error: invalidParamsError("run params must be { argv }"),
		};
	}
	const raw = field(params, "argv");
	if (!Array.isArray(raw) || raw.length === 0) {
		return {
			ok: false,
			error: invalidParamsError(
				"run argv must be a non-empty array of strings",
			),
		};
	}
	const argv: Array<string> = [];
	for (const entry of raw) {
		if (typeof entry !== "string") {
			return {
				ok: false,
				error: invalidParamsError(
					"run argv must be a non-empty array of strings",
				),
			};
		}
		argv.push(entry);
	}
	if (isHumanOnly(argv)) {
		return {
			ok: false,
			error: serverError(
				"CDX-E107",
				"human-only command refused: no interactive TTY on the server",
				"Run this command yourself in an interactive terminal, not through an agent or hook.",
				{ commandLine: commandLine(argv) },
			),
		};
	}
	return { ok: true, value: await executeCaptured(ctx, argv) };
}
