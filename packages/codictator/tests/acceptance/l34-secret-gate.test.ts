// SPEC §4.7.1 + §4.14.4 + §4.15.1: the L3/L4 secret gate end to end.
// A staged secret vector blocks the installed pre-commit hook through the
// real launcher (BUG-0012), and a committed vector blocks `ci verify`
// over an explicit --base/--head range and over GITHUB_EVENT_PATH, the
// CI shape (BUG-0013). The vector is assembled from two literals so this committed
// test source never holds a live-pattern literal the repo's own L4 gate
// would flag.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJson } from "../../src/kernel/index.ts";
import { type CliResult, runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

// Split so no single committed line matches the kernel known-format scan;
// the runtime value is one contiguous `sk-…` key of 34 tail characters.
const VECTOR = ["sk-dogfood-rejected-", "0123456789abcdef"].join("");

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
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
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
	writeFileSync(path.join(repo.dir, name), content, "utf8");
	repo.git(["add", name]);
}

test("[§4.14] installed pre-commit hook blocks a staged secret (L3)", async () => {
	// SPEC §4.14.4 + §4.7.1: `install-hooks` writes working hooks, and the
	// staged secret vector blocks the commit through the real launcher.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		installLauncher(repo);
		const installed = await cli(["install-hooks"], repo.dir);
		assert.equal(installed.code, 0);
		const hook = readFileSync(
			path.join(repo.dir, ".githooks", "pre-commit"),
			"utf8",
		);
		assert.ok(hook.includes("git pre-commit"));
		assert.equal(
			repo.git(["config", "--get", "core.hooksPath"]).trim(),
			".githooks",
		);
		stage(repo, "notes.txt", "// [§4.7] hook control file\nhello\n");
		const clean = await runGitHook(repo, "pre-commit");
		assert.equal(clean.code, 0);
		stage(repo, "leak.txt", `const key = "${VECTOR}";\n`);
		const blocked = await runGitHook(repo, "pre-commit");
		assert.equal(blocked.code, 1);
		assert.ok(blocked.stdout.includes("core/no-secrets"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci verify blocks a committed secret (L4)", async () => {
	// SPEC §4.15.1 + §4.7.1: a committed key on the branch blocks the merge
	// gate, both over the explicit --base/--head range and over
	// GITHUB_EVENT_PATH, the CI shape.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		repo.commit("guardrails");
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		stage(repo, "leak.txt", `const key = "${VECTOR}";\n`);
		repo.commit("add key");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const range = await cli(
			["--json", "ci", "verify", "--base", base, "--head", head],
			repo.dir,
		);
		assert.equal(range.code, 1);
		assert.ok(ruleIds(range.stdout).includes("core/no-secrets"));
		const eventFile = path.join(repo.dir, "event.json");
		writeFileSync(
			eventFile,
			JSON.stringify({ pull_request: { base: { sha: base } }, after: head }),
		);
		const evented = await cli(["--json", "ci", "verify"], repo.dir, {
			GITHUB_EVENT_PATH: eventFile,
		});
		assert.equal(evented.code, 1);
		assert.ok(ruleIds(evented.stdout).includes("core/no-secrets"));
	} finally {
		repo.cleanup();
	}
});

function ruleIds(stdout: string): Array<string> {
	const parsed = parseJson(stdout.slice(stdout.indexOf("{")));
	assert.ok(parsed.ok);
	const body = parsed.value as { findings: Array<{ ruleId: string }> };
	assert.ok(Array.isArray(body.findings));
	return body.findings.map((finding) => finding.ruleId);
}
