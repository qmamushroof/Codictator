import { strict as assert } from "node:assert";

import test from "node:test";

import { readTask } from "../../../src/cli/tasks.ts";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

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

function jsonOut(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
}

test("[§4.12] review rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside submit/resolve is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["review", "bogus", "--file", "f.json"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator review"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit needs a file flag", async () => {
	// SPEC §4.19.2: submit without --file is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["review", "submit"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator review"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with a missing file fails CDX-E607", async () => {
	// SPEC §4.12.4: an unreadable findings file fails closed (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
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

test("[§4.12] review submit with a bad file fails CDX-E607", async () => {
	// SPEC §4.12.4: findings that are not JSON fail closed (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile("findings.json", "not json\n");
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

test("[§4.12] review submit verdicts a findings file with blockers", async () => {
	// SPEC §4.12.4: an empty findings file carries no review round, so
	// the verdict blocks (exit 1) with the finding and blocker counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			JSON.stringify({ version: 1, findings: [] }),
		);
		const ran = await cli(
			["--json", "review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 1);
		const body = jsonOut(ran.stdout) as { findings: number; blockers: number };
		assert.equal(body.findings, 2);
		assert.equal(body.blockers, 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit records the round on the task", async () => {
	// SPEC §4.12.4: a fully bound round with no blockers records on the
	// task when --task names it.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/tasks/T-0001.json",
			JSON.stringify({
				version: 1,
				id: "T-0001",
				type: "docs",
				title: "task",
				branch: "main",
				phase: "review",
				phases: [],
				spec: [],
				acceptanceCriteria: [],
				files: { allow: [] },
			}),
		);
		repo.writeFile(
			"findings.json",
			JSON.stringify({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await cli(
			[
				"--json",
				"review",
				"submit",
				"--file",
				"findings.json",
				"--task",
				"T-0001",
			],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		const recorded = await readTask(repo.dir, "T-0001");
		assert.equal(recorded?.reviews?.length, 1);
		assert.equal(recorded?.reviews?.[0]?.reviewerSession, "sess-1");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with an unreadable absolute path fails CDX-E607", async () => {
	// SPEC §4.12.4: an absolute --file stays inside the repo root, so a
	// path outside it reads back unreadable.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["review", "submit", "--file", "/no-such-dir/findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E607"));
	} finally {
		repo.cleanup();
	}
});
