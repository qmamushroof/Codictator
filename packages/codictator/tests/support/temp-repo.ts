// SPEC §10.2: acceptance tests run the CLI end to end in temporary git repos
// built from fixtures. This builder uses real git and a real fs; tests/support
// is non-production code, so SPEC §10.3 item 3 (kernel-only OS access) still
// holds for src/. Fixed author dates keep commit hashes deterministic.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TempRepo {
	readonly dir: string;
	git(args: ReadonlyArray<string>): string;
	writeFile(relative: string, content: string): void;
	commit(message: string): void;
	cleanup(): void;
}

export interface BareRepo {
	readonly dir: string;
	cleanup(): void;
}

const FIXED_GIT_DATE = "2026-01-01T00:00:00+00:00";

// Temp-dir removal races lazy OS reclamation (ENOTEMPTY on macOS) when a
// just-written tree is removed, so retry the sync removal with linear
// backoff and rethrow the last error to keep genuine failures visible.
const RETRYABLE_CLEANUP_CODES: ReadonlySet<string> = new Set([
	"ENOTEMPTY",
	"EBUSY",
	"EPERM",
]);

function removeDirWithRetry(dir: string): void {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch (error) {
			lastError = error;
			const code =
				error instanceof Error
					? (error as NodeJS.ErrnoException).code
					: undefined;
			if (code === undefined || !RETRYABLE_CLEANUP_CODES.has(code)) {
				throw error;
			}
			if (attempt === 5) {
				throw error;
			}
			Atomics.wait(
				new Int32Array(new SharedArrayBuffer(4)),
				0,
				0,
				100 * attempt,
			);
		}
	}
	throw lastError;
}

function runGit(
	dir: string,
	args: ReadonlyArray<string>,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return execFileSync("git", [...args], { cwd: dir, encoding: "utf8", env });
}

export function createTempRepo(
	files: Readonly<Record<string, string>> = {},
): TempRepo {
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-test-"));
	const git = (args: ReadonlyArray<string>): string => runGit(dir, args);
	try {
		git(["init", "-b", "main"]);
	} catch {
		git(["init"]);
	}
	git(["config", "user.email", "codictator-test@example.com"]);
	git(["config", "user.name", "codictator-test"]);
	git(["config", "commit.gpgsign", "false"]);
	const repo: TempRepo = {
		dir,
		git,
		writeFile: (relative: string, content: string): void => {
			const full = path.join(dir, relative);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, content, "utf8");
			git(["add", "-A"]);
		},
		commit: (message: string): void => {
			const fixedEnv: NodeJS.ProcessEnv = {
				...process.env,
				GIT_AUTHOR_DATE: FIXED_GIT_DATE,
				GIT_COMMITTER_DATE: FIXED_GIT_DATE,
			};
			runGit(dir, ["commit", "-m", message], fixedEnv);
		},
		cleanup: (): void => {
			removeDirWithRetry(dir);
		},
	};
	const entries = Object.entries(files).sort(([a], [b]) => {
		if (a === b) {
			return 0;
		}
		return a < b ? -1 : 1;
	});
	for (const [name, content] of entries) {
		repo.writeFile(name, content);
	}
	if (entries.length > 0) {
		repo.commit("test fixture");
	}
	return repo;
}

// SPEC §10.2: a bare repo stands in for the git host in acceptance tests.
// The subject pushes its branch here; assertions read it back with
// `git --git-dir <dir>`. Fixed author dates keep the pushed hashes
// deterministic like TempRepo commits.
export function createBareRepo(): BareRepo {
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-host-"));
	try {
		runGit(dir, ["init", "--bare", "-b", "main"]);
	} catch {
		runGit(dir, ["init", "--bare"]);
	}
	return {
		dir,
		cleanup: (): void => {
			removeDirWithRetry(dir);
		},
	};
}
