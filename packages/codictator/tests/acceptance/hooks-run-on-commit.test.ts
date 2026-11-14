// SPEC §4.14.4 + BUG-0093: hooks written by install-hooks are executable, so
// a real `git commit` runs them. A staged secret vector must make git itself
// refuse the commit; with a non-executable hook git skips it silently and
// the commit lands. POSIX only: Windows git ignores the executable bit.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type CliResult, runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

// Two literals so this committed source holds no live-pattern literal.
const VECTOR = ["sk-dogfood-rejected-", "0123456789abcdef"].join("");

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

test("[§4.14.4] a real git commit runs the installed pre-commit hook (BUG-0093)", {
	skip: process.platform === "win32",
}, async () => {
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
		repo.commit("hook path fixture");
		const installed = await installHooks(repo);
		assert.equal(installed.code, 0);
		const before = repo.git(["rev-parse", "HEAD"]);
		repo.writeFile("leak.txt", `const key = "${VECTOR}";\n`);
		assert.throws(() => repo.commit("commit a secret through the hooks"));
		assert.equal(repo.git(["rev-parse", "HEAD"]), before);
	} finally {
		repo.cleanup();
	}
});
