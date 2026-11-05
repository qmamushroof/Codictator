import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
}

function seedTask(repo: TempRepo): void {
	repo.writeFile(
		".codictator/tasks/T-0001.json",
		`${JSON.stringify({
			version: 1,
			id: "T-0001",
			type: "docs",
			title: "task",
			branch: "main",
			phase: "discovery",
			phases: [],
			spec: [],
			acceptanceCriteria: [],
			files: { allow: [] },
		})}\n`,
	);
}

test("[§4.12] review submit with a shapeless findings file fails CDX-E607", async () => {
	// SPEC §4.12.4: findings that are not a list fail closed (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			JSON.stringify({ version: 1, findings: {} }),
		);
		const ran = await cli(
			["review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E607"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit prints human verdicts", async () => {
	// SPEC §4.12.4: the human rendering prints each finding, and resolve
	// reports the still-open blockers and majors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			JSON.stringify({ version: 1, findings: [] }),
		);
		const submitted = await cli(
			["review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(submitted.code, 1);
		assert.ok(submitted.stdout.includes("core/"));
		const resolved = await cli(
			["review", "resolve", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(resolved.code, 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review outside a repo fails CDX-E703", async () => {
	// SPEC §4.12.4: the review words resolve the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-noreview-"));
	try {
		const ran = await cli(["review", "submit", "--file", "findings.json"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.12] test proof usage rejects a bare word", async () => {
	// SPEC §4.19.2: test takes red|green with a task and titles.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["test", "red"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator test"));
		const bare = await cli(["test", "bogus"], repo.dir);
		assert.equal(bare.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] test proof for an unknown task fails CDX-E903", async () => {
	// SPEC §4.12.4: proof attaches to the task record; unknown ids fail
	// closed (exit 5).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["test", "red", "--task", "T-0099", "Some title"],
			repo.dir,
		);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] test proof without a commit fails CDX-E703", async () => {
	// SPEC §4.12.4: red and green proofs bind HEAD, so an unborn HEAD
	// fails closed (exit 6).
	const repo = createTempRepo();
	try {
		seedTask(repo);
		const ran = await cli(
			["test", "red", "--task", "T-0001", "Some title"],
			repo.dir,
		);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] test proof records red and green", async () => {
	// SPEC §4.12.4: with a commit the proof binds HEAD and tree.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo);
		const red = await cli(
			["test", "red", "--task", "T-0001", "Some title"],
			repo.dir,
		);
		assert.equal(red.code, 0);
		assert.ok(red.stdout.includes("recorded red proof for T-0001"));
		const green = await cli(
			["test", "green", "--task", "T-0001", "T"],
			repo.dir,
		);
		assert.equal(green.code, 0);
		assert.ok(green.stdout.includes("recorded green proof for T-0001"));
	} finally {
		repo.cleanup();
	}
});
