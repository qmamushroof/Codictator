// SPEC §4.3.2 + BUG-0092: after a branch is rebased onto the default branch
// the installed pre-push hook judges only the branch's own new commits, not
// the commits already merged there. The launcher runs the real hook entry
// against a temp repo with a bare remote, the hook-path acceptance pattern.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type CliResult, runNodeScript } from "../support/cli-runner.ts";
import {
	buildRebasedBranch,
	type PrePushScenario,
} from "../support/prepush-scenario.ts";
import { createBareRepo, createTempRepo } from "../support/temp-repo.ts";

function packageRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function prePushViaLauncher(
	scenario: PrePushScenario,
): Promise<CliResult> {
	const repo = createTempRepo();
	const host = createBareRepo();
	try {
		buildRebasedBranch(repo, host, scenario);
		const launcher = readFileSync(
			path.join(packageRoot(), "..", "..", ".codictator", "bin", "run.mjs"),
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
		mkdirSync(path.join(repo.dir, ".codictator", "bin"), { recursive: true });
		writeFileSync(
			path.join(repo.dir, ".codictator", "bin", "run.mjs"),
			launcher,
			"utf8",
		);
		const target = path.join(packageRoot(), "src", "cli", "main.ts");
		writeFileSync(
			path.join(shimDir, "main.js"),
			`export { main } from "${pathToFileURL(realpathSync(target)).href}";\n`,
			"utf8",
		);
		return await runNodeScript({
			nodeArgs: [
				path.join(repo.dir, ".codictator", "bin", "run.mjs"),
				"git",
				"pre-push",
			],
			cwd: repo.dir,
			timeoutMs: 120000,
		});
	} finally {
		repo.cleanup();
		host.cleanup();
	}
}

test("[§4.3.2] the pre-push hook judges only the rebased branch's own commit (BUG-0092)", async () => {
	const clean = await prePushViaLauncher({
		mainSecret: true,
		ownSecret: false,
		setHead: true,
	});
	assert.equal(clean.code, 0);
	const own = await prePushViaLauncher({
		mainSecret: false,
		ownSecret: true,
		setHead: true,
	});
	assert.equal(own.code, 1);
	assert.ok(own.stdout.includes("core/no-secrets"));
});
