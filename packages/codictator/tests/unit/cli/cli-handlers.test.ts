import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

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

test("[§4.15] ci verify with extra args is a usage error", async () => {
	// SPEC §4.19.2: ci verify takes no flags or positionals.
	const repo = createTempRepo();
	try {
		const ran = await cli(["ci", "verify", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator ci verify"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci verify json carries the CI summary", async () => {
	// SPEC §4.15.1 + §4.18.4: the verify decision ships with the wired
	// CI summary in §4.18.4 order. Integrity exception IE-10-civerify-exit
	// (rule core/no-assertion-loss, path
	// packages/codictator/tests/unit/cli/cli-handlers.test.ts, reason: the
	// temp repo yields advise-only findings (unreadable protection), which
	// exit 0 per SPEC §8.2 "Pass (allow or advise only)" + §4.15.1 "exits
	// per §8"; the old assertion pinned the pre-read findings.length rule).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["--json", "ci", "verify"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as {
			findings: Array<{ ruleId: string }>;
			summary: string;
		};
		assert.ok(Array.isArray(body.findings));
		assert.ok(body.summary.includes("# codictator CI summary"));
		assert.ok(
			body.summary.indexOf("## integrity then blocking findings") <
				body.summary.indexOf("## unverifiable items"),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci sweep plans the sweep PR", async () => {
	// SPEC §4.15.4: sweep without an open PR reports the action and PR.
	const repo = createTempRepo();
	try {
		const ran = await cli(["ci", "sweep"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("sweep"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change needs author and files", async () => {
	// SPEC §4.15.3: the bot-change word takes --author and --files.
	const repo = createTempRepo();
	try {
		const ran = await cli(["ci", "record-bot-change"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator ci record-bot-change"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change qualifies a bot manifest change", async () => {
	// SPEC §4.15.3: a recognised bot touching only manifests qualifies
	// with a commit write (exit 0).
	const repo = createTempRepo();
	try {
		const ran = await cli(
			[
				"--json",
				"ci",
				"record-bot-change",
				"--author",
				"renovate[bot]",
				"--files",
				"package-lock.json",
			],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as {
			qualifies: boolean;
			writeCommit: boolean;
		};
		assert.equal(body.qualifies, true);
		assert.equal(body.writeCommit, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change from a fork requires the entry", async () => {
	// SPEC §4.15.7 EC-8: fork PRs are never written to; the history
	// entry is required, so the finding blocks (exit 1).
	const repo = createTempRepo();
	try {
		const ran = await cli(
			[
				"--json",
				"ci",
				"record-bot-change",
				"--author",
				"renovate[bot]",
				"--files",
				"package-lock.json",
				"--fork",
			],
			repo.dir,
		);
		assert.equal(ran.code, 1);
		const body = jsonOut(ran.stdout) as {
			qualifies: boolean;
			writeCommit: boolean;
			findings: unknown;
		};
		assert.equal(body.qualifies, true);
		assert.equal(body.writeCommit, false);
		assert.ok(Array.isArray(body.findings));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside verify/sweep/record-bot-change is
	// a usage error (exit 2).
	const repo = createTempRepo();
	try {
		const ran = await cli(["ci", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator ci"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci outside a repo fails CDX-E703", async () => {
	// SPEC §4.15.2: every ci word resolves the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-noci-"));
	try {
		const ran = await cli(["ci", "verify"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
