import { strict as assert } from "node:assert";

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

test("[§4.14] verify flags a changed artifact", async () => {
	// SPEC §4.14.2: an artifact edited after regen differs from its
	// manifest entry (exit 1).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regenerated = await cli(["regen"], repo.dir);
		assert.equal(regenerated.code, 0);
		repo.writeFile("AGENTS.md", "hand-edited\n");
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stdout.includes("differs from its manifest entry"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify flags a removed artifact", async () => {
	// SPEC §4.14.2: an artifact deleted after regen reads missing.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regenerated = await cli(["regen"], repo.dir);
		assert.equal(regenerated.code, 0);
		const fs = await import("node:fs");
		fs.rmSync(path.join(repo.dir, ".githooks", "pre-commit"), { force: true });
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stdout.includes("missing or unreadable"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] report and context reject unknown flags", async () => {
	// SPEC §4.19.6 EC-1: unknown flags are usage errors even when the
	// words are otherwise valid.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const report = await cli(["report", "--bogus"], repo.dir);
		assert.equal(report.code, 2);
		const context = await cli(["context", "--bogus"], repo.dir);
		assert.equal(context.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] guardrail commands render as data", async () => {
	// SPEC §4.19.2: regen, install-hooks and the uninstall refusal ship
	// as --json envelopes.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await cli(["--json", "regen"], repo.dir);
		assert.equal(regen.code, 0);
		const regenBody = jsonOut(regen.stdout) as { regenerated: boolean };
		assert.equal(regenBody.regenerated, true);
		const installed = await cli(["--json", "install-hooks"], repo.dir);
		assert.equal(installed.code, 0);
		const installedBody = jsonOut(installed.stdout) as { installed: boolean };
		assert.equal(installedBody.installed, true);
		const refused = await cli(["--json", "uninstall"], repo.dir);
		assert.equal(refused.code, 4);
		const refusedBody = jsonOut(refused.stdout) as { code: string };
		assert.equal(refusedBody.code, "CDX-E107");
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] status and verify read the scoped flags", async () => {
	// SPEC §4.14 + §4.18.3: --staged and --all parse; context --all with
	// a readable config names its hash.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const staged = await cli(["verify", "--staged"], repo.dir);
		assert.equal(staged.code, 0);
		const all = await cli(["verify", "--all"], repo.dir);
		assert.equal(all.code, 0);
		const context = await cli(["context", "--all"], repo.dir);
		assert.equal(context.code, 0);
		assert.ok(context.stdout.includes("config "));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status observes harness events", async () => {
	// SPEC §4.18.3: an event with a harness marks it active and clears
	// the coverage gap.
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
				harness: "muse-code",
				ruleIds: [],
				durationMs: 5,
				configHash: "abc",
				packs: {},
			})}\n`,
		);
		const ran = await cli(["status"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("- muse-code: active"));
		assert.ok(ran.stdout.includes("1 observed"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify flags a missing manifest file", async () => {
	// SPEC §4.14.2: a manifest path that reads back nothing blocks with
	// the unreadable note.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const fs = await import("node:fs");
		fs.mkdirSync(path.join(repo.dir, ".codictator", "manifest.json"));
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stdout.includes("manifest unreadable"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with --pr names the flag", async () => {
	// SPEC §4.13.1: --pr plans the upgrade as a pull request.
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		repo.writeFile(".codictator/registry-snapshot.json", "{}\n");
		const ran = await cli(["deps", "upgrade", "--pr"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("with --pr"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline show with an extra arg is a usage error", async () => {
	// SPEC §4.19.2: show takes no args.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["baseline", "show", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator baseline show"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init reports an existing repo", async () => {
	// SPEC §4.19.2: usage parsing precedes the gate, so a stray
	// positional is a usage error even without a TTY.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["init", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator init"));
	} finally {
		repo.cleanup();
	}
});
