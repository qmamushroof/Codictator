// SPEC §4.9.3 + §4.14.4 (BUG-0079): the installed commit-msg hook exempts a
// merge commit from the history entry judgment. A real `git merge --no-ff`
// runs the hooks `install-hooks` wrote through the real launcher; the merged
// branch's own history entry must not block the merge, and the merge commit
// still carries the Codictator-L3 trailer.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type CliResult, runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..");
}

function installLauncher(repo: TempRepo): void {
	const launcher = readFileSync(
		path.join(packageRoot(), "..", "..", ".codictator", "bin", "run.mjs"),
		"utf8",
	);
	repo.writeFile(".codictator/bin/run.mjs", launcher);
	const shimDir = path.join(
		repo.dir,
		"node_modules",
		"codictator",
		"dist",
		"cli",
	);
	mkdirSync(shimDir, { recursive: true });
	const target = path.join(packageRoot(), "src", "cli", "main.ts");
	writeFileSync(
		path.join(shimDir, "main.js"),
		`export { main } from "${pathToFileURL(realpathSync(target)).href}";\n`,
		"utf8",
	);
}

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
}

function entry(subject: string): string {
	return `## 2026-11-13 · ${subject}\n- **Kind:** docs\n- **Task:** T-0001\n- **Why:** x\n- **Docs:** none\n`;
}

test("[§4.9.3] installed commit-msg hook lets a git merge commit through with the trailer", async () => {
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
		repo.writeFile("docs/HISTORY/2026-11-13.md", "# History\n");
		installLauncher(repo);
		repo.git(["add", "-A"]);
		repo.git(["commit", "--no-verify", "-m", "base"]);
		const installed = await cli(["install-hooks"], repo.dir);
		assert.equal(installed.code, 0);
		repo.git(["add", "-A"]);
		repo.git(["commit", "--no-verify", "-m", "install hooks"]);
		const main = repo.git(["branch", "--show-current"]).trim();
		repo.git(["checkout", "-b", "feature"]);
		repo.writeFile(
			"docs/HISTORY/2026-11-13.md",
			`# History\n\n${entry("docs: merged branch")}`,
		);
		repo.git(["add", "-A"]);
		repo.git(["commit", "--no-verify", "-m", "docs: merged branch"]);
		repo.git(["checkout", main]);
		repo.writeFile("other.txt", "main moved\n");
		repo.git(["add", "-A"]);
		repo.git(["commit", "--no-verify", "-m", "other"]);
		repo.git(["merge", "--no-ff", "-m", "Merge branch 'feature'", "feature"]);
		const parents = repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]);
		assert.equal(parents.trim().split(" ").length, 3);
		assert.match(repo.git(["log", "-1", "--format=%B"]), /^Codictator-L3: /m);
	} finally {
		repo.cleanup();
	}
});
