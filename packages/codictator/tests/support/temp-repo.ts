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

const FIXED_GIT_DATE = "2026-01-01T00:00:00+00:00";

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
			rmSync(dir, { recursive: true, force: true });
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
