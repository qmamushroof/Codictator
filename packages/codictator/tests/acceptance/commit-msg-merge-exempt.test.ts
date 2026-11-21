// SPEC §4.9.3 + §4.14.4 + BUG-0079: a real `git merge --no-ff` of a branch
// that recorded its own history entry commits through the installed
// commit-msg hook, because merge commits are exempt from the entry rule.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type CliResult, runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

const ENTRY = [
	"## 2026-11-21 · fix(demo): branch change",
	"- **Kind:** code",
	"- **Task:** T-0001",
	"- **Why:** the branch records its own entry.",
	"- **What went wrong:** none",
	"- **Trade-offs:** none",
	"- **Lessons:** none",
	"",
].join("\n");

function packageRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function installLauncher(repo: TempRepo): void {
	const launcher = readFileSync(
		path.join(packageRoot(), "..", "..", ".codictator", "bin", "run.mjs"),
		"utf8",
	);
	mkdirSync(path.join(repo.dir, ".codictator", "bin"), { recursive: true });
	writeFileSync(
		path.join(repo.dir, ".codictator", "bin", "run.mjs"),
		launcher,
		"utf8",
	);
	const shimDir = path.join(
		repo.dir,
		"node_modules",
		"codictator",
		"dist",
		"cli",
	);
	mkdirSync(shimDir, { recursive: true });
	const target = realpathSync(
		path.join(packageRoot(), "src", "cli", "main.ts"),
	);
	writeFileSync(
		path.join(shimDir, "main.js"),
		`export { main } from "${pathToFileURL(target).href}";\n`,
		"utf8",
	);
}

async function installHooks(repo: TempRepo): Promise<CliResult> {
	const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(["install-hooks"], ${JSON.stringify(repo.dir)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd: repo.dir,
		timeoutMs: 120000,
	});
}

test("[§4.9.3] a git merge --no-ff of a recorded branch commits through the installed commit-msg hook", async () => {
	const repo = createTempRepo();
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "unknown",
				packs: [],
				harnesses: ["muse-code", "opencode"],
			}),
		);
		installLauncher(repo);
		repo.writeFile("docs/HISTORY/2026-11-21.md", "# History — 2026-11-21\n");
		repo.commit("hook path fixture");
		const installed = await installHooks(repo);
		assert.equal(installed.code, 0);
		repo.git(["checkout", "-b", "feature"]);
		// The branch commits bypass the hooks: only the merge is under test.
		repo.writeFile("src/feature.ts", "export const feature = 1;\n");
		repo.writeFile(
			"docs/HISTORY/2026-11-21.md",
			`# History — 2026-11-21\n\n${ENTRY}`,
		);
		repo.git(["commit", "--no-verify", "-m", "fix(demo): branch change"]);
		repo.git(["checkout", "main"]);
		repo.writeFile("src/other.ts", "export const other = 1;\n");
		repo.git(["commit", "--no-verify", "-m", "chore: diverge main"]);
		const before = repo.git(["rev-parse", "HEAD"]);
		repo.git(["merge", "--no-ff", "-m", "Merge branch 'feature'", "feature"]);
		const parents = repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]);
		assert.equal(parents.trim().split(" ").length, 3);
		assert.notEqual(repo.git(["rev-parse", "HEAD"]), before);
	} finally {
		repo.cleanup();
	}
});
