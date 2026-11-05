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

test("[§4.18] report with extra args is a usage error", async () => {
	// SPEC §4.19.2: report takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["report", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator report"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] report outside a repo fails CDX-E703", async () => {
	// SPEC §4.18.5: the report resolves the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-noreport-"));
	try {
		const ran = await cli(["report"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.18] report renders local metrics", async () => {
	// SPEC §4.18.5: PRD §10 metrics from the local log only; the JSON
	// rendering carries the event and corruption counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["report"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("corrupt lines skipped: 0"));
		const asJson = await cli(["--json", "report"], repo.dir);
		assert.equal(asJson.code, 0);
		const body = jsonOut(asJson.stdout) as {
			events: number;
			corrupt: number;
			text: string;
		};
		assert.equal(body.events, 0);
		assert.equal(body.corrupt, 0);
		assert.ok(body.text.includes("no blocks observed"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] report counts logged events", async () => {
	// SPEC §4.18.5: a logged block moves the self-correction rate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/state/events.jsonl",
			`${JSON.stringify({
				v: 1,
				id: "evt-1",
				ts: "2026-01-01T00:00:00.000Z",
				now: "2026-01-01T00:00:00.000Z",
				kind: "verdict",
				layer: "L1",
				trigger: "pre-tool",
				ruleIds: ["core/no-secrets"],
				decision: "block",
				durationMs: 5,
				configHash: "abc",
				packs: {},
			})}\n`,
		);
		const ran = await cli(["--json", "report"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as { events: number; text: string };
		assert.equal(body.events, 1);
		assert.ok(body.text.includes("self-correction rate: 0/1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] context with extra args is a usage error", async () => {
	// SPEC §4.19.2: context takes only --all.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["context", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator context"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] context prints the scoped injection", async () => {
	// SPEC §4.19.2: the injection prints with and without --all; without
	// a readable config --all names the gap.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["context"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.length > 0);
		const all = await cli(["context", "--all"], repo.dir);
		assert.equal(all.code, 0);
		assert.ok(all.stdout.includes("config unknown (unreadable)"));
		const asJson = await cli(["--json", "context"], repo.dir);
		assert.equal(asJson.code, 0);
		const body = jsonOut(asJson.stdout) as { context: string };
		assert.ok(body.context.length > 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] waive without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: waive is human-only, so the child process without a
	// TTY is refused with CDX-E107 (exit 4) before flags are parsed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			[
				"waive",
				"core/context-soft-band",
				"--set",
				"k=1",
				"--reason",
				"r",
				"--expires",
				"2099-01-01",
			],
			repo.dir,
		);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with an unknown profile is a usage error", async () => {
	// SPEC §4.19.2: profiles are app/library/cli/service, checked before
	// the human-only gate so usage fails even without a TTY.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["init", "--profile", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator init"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: adoption is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["init"], repo.dir);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check prints human findings", async () => {
	// SPEC §4.8: the human rendering lists each finding with remediation.
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		const ran = await cli(["deps", "check"], repo.dir);
		assert.ok(ran.code === 0 || ran.code === 1);
		assert.ok(ran.stdout.length > 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade without manifests fails CDX-E903", async () => {
	// SPEC §4.8: upgrade analyses manifests first.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "upgrade"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("no package manifests found"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with a snapshot plans pins", async () => {
	// SPEC §4.13.1: with a registry snapshot the upgrade plans the pin
	// count human-readably and as data.
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		repo.writeFile(".codictator/registry-snapshot.json", "{}\n");
		const ran = await cli(["deps", "upgrade"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("deps upgrade planned for"));
		const asJson = await cli(["--json", "deps", "upgrade"], repo.dir);
		assert.equal(asJson.code, 0);
		const body = jsonOut(asJson.stdout) as { planned: number; pr: boolean };
		assert.equal(body.pr, false);
		assert.ok(body.planned >= 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with an unknown flag is a usage error", async () => {
	// SPEC §4.19.2: upgrade takes only --pr.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "upgrade", "--bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator deps upgrade"));
	} finally {
		repo.cleanup();
	}
});
