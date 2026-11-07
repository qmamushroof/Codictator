import { strict as assert } from "node:assert";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
	stdin?: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
		...(stdin === undefined ? {} : { stdin }),
	});
}

function jsonOut(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
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

test("[§4.14] ci verify blocks a trailer-less commit in range (L4)", async () => {
	// SPEC §4.14.2 core/no-bypass at L4 (BUG-0018): a non-merge commit in
	// range without the Codictator-L3 trailer blocks the merge gate, even
	// when no other finding fires.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		repo.commit("base state");
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		repo.writeFile("feature.txt", "a feature\n");
		repo.commit("add a feature");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const ran = await cli(
			["--json", "ci", "verify", "--base", base, "--head", head],
			repo.dir,
		);
		assert.equal(ran.code, 1);
		const body = jsonOut(ran.stdout) as {
			findings: Array<{ ruleId: string }>;
		};
		assert.ok(
			body.findings.some((finding) => finding.ruleId === "core/no-bypass"),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] ci verify allows a ranged commit carrying the trailer (L4)", async () => {
	// SPEC §4.14.2: the trailer proves the commit-msg gate ran, so a
	// trailer-carrying range with no other finding passes.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		repo.commit("base state");
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		repo.writeFile("feature.txt", "a feature\n");
		repo.commit("add a feature\n\nCodictator-L3: deadbeef");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const ran = await cli(
			["--json", "ci", "verify", "--base", base, "--head", head],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as {
			findings: Array<{ ruleId: string }>;
		};
		assert.ok(
			!body.findings.some((finding) => finding.ruleId === "core/no-bypass"),
		);
	} finally {
		repo.cleanup();
	}
});
