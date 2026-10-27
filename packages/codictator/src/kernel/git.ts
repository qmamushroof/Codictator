// SPEC §4.1.1: the real Git port, implemented over the Proc port running
// `git`, never mutating history. Every failure is CDX-E703 (SPEC §8: git
// missing or not a git repository); messages name the operation, never file
// content or command output (SPEC §9.2, CONVENTIONS).
import { type CdxError, makeError } from "./errors.ts";
import type { Git, Proc, ProcResult } from "./index.ts";
import { err, ok, type Result } from "./result.ts";

// Git answers quickly or not at all; a hung git never blocks the hook path
// past its harness timeout (SPEC §9.3).
const GIT_TIMEOUT_MS = 30_000;

// Diffs can be large, but an unbounded child can wedge the hook; past the
// cap the caller retries a narrower range.
const GIT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function gitMissingError(): CdxError {
	return makeError(
		"CDX-E703",
		"git executable not found on PATH",
		"Install git and ensure it is on PATH.",
	);
}

function gitOpError(op: string, reason: string): CdxError {
	return makeError(
		"CDX-E703",
		`git ${op} ${reason}`,
		"Install git and run inside a git repository with git on PATH.",
	);
}

function procFailure(op: string, result: ProcResult): CdxError | undefined {
	if (result.timedOut) {
		return gitOpError(op, "timed out");
	}
	if (result.truncated) {
		return gitOpError(op, "output exceeded the size cap");
	}
	if (result.code === -1) {
		return gitMissingError();
	}
	if (result.code !== 0) {
		return gitOpError(op, "failed");
	}
	return undefined;
}

export class NodeGit implements Git {
	private readonly proc: Proc;
	private readonly cwd: string;

	constructor(proc: Proc, cwd: string) {
		this.proc = proc;
		this.cwd = cwd;
	}

	private exec(argv: ReadonlyArray<string>): Promise<ProcResult> {
		return this.proc.run(argv, {
			cwd: this.cwd,
			env: {},
			timeoutMs: GIT_TIMEOUT_MS,
			maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
		});
	}

	async root(): Promise<Result<string>> {
		const result = await this.exec(["git", "rev-parse", "--show-toplevel"]);
		const failure = procFailure("rev-parse", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout.trim());
	}

	async head(): Promise<Result<string>> {
		const result = await this.exec(["git", "rev-parse", "HEAD"]);
		const failure = procFailure("rev-parse", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout.trim());
	}

	async stagedFiles(): Promise<Result<Array<string>>> {
		const result = await this.exec(["git", "diff", "--name-only", "--cached"]);
		const failure = procFailure("staged files", result);
		if (failure !== undefined) {
			return err(failure);
		}
		const files = result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
		files.sort();
		return ok(files);
	}

	async diff(base: string, head: string): Promise<Result<string>> {
		const result = await this.exec(["git", "diff", base, head]);
		const failure = procFailure("diff", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout);
	}

	async show(rev: string, path: string): Promise<Result<string>> {
		const result = await this.exec(["git", "show", `${rev}:${path}`]);
		const failure = procFailure("show", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout);
	}

	async config(key: string): Promise<Result<string>> {
		const result = await this.exec(["git", "config", "--get", key]);
		// An unset key exits 1 with no output; like the port fake, unset
		// text queries answer empty instead of failing.
		if (result.code === 1 && !result.timedOut && !result.truncated) {
			return ok("");
		}
		const failure = procFailure("config", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout.trim());
	}

	async log(range: string): Promise<Result<string>> {
		// Fixed format: default log output carries locale-dependent dates,
		// which would break byte-identical replay (CONVENTIONS).
		const result = await this.exec(["git", "log", "--format=%H %s", range]);
		const failure = procFailure("log", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout);
	}

	async isClean(): Promise<Result<boolean>> {
		const result = await this.exec(["git", "status", "--porcelain"]);
		const failure = procFailure("status", result);
		if (failure !== undefined) {
			return err(failure);
		}
		return ok(result.stdout.trim() === "");
	}
}
