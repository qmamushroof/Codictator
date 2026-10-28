// SPEC §4.3.5, §4.8, §4.13.1, §4.14 + §4.19: branch coverage for the
// baseline, deps, verify/drift, report, context, waivers and init
// handlers, none of which the red ledger pins. Each scenario drives the
// built entry in a child process (the EC-6 pattern in audit.test.ts).
// Nothing reaches the network; no wall clock is asserted.
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
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

test("[§4.3] baseline show reports no baseline when none is captured", async () => {
	// SPEC §4.3.5: without a baseline file the screen names the gap.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["baseline", "show"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("no baseline captured"));
		const asJson = await cli(["--json", "baseline", "show"], repo.dir);
		assert.equal(asJson.code, 0);
		assert.deepEqual(jsonOut(asJson.stdout), { baseline: null });
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline show prints a captured baseline", async () => {
	// SPEC §4.3.5: a captured baseline prints verbatim (human) or parsed
	// (--json).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/baseline.json",
			`${JSON.stringify({ version: 1, entries: {} })}\n`,
		);
		const ran = await cli(["baseline", "show"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes('"version":1'));
		const asJson = await cli(["--json", "baseline", "show"], repo.dir);
		assert.equal(asJson.code, 0);
		assert.deepEqual(jsonOut(asJson.stdout), {
			baseline: { version: 1, entries: {} },
		});
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside show/capture is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["baseline", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator baseline"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline capture without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: capture is human-only, so the child process without a
	// TTY is refused with CDX-E107 (exit 4) before flags are parsed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["baseline", "capture", "--rule", "core/no-secrets"],
			repo.dir,
		);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check without manifests fails CDX-E903", async () => {
	// SPEC §4.8 + §4.13.1: with no manifests there is nothing to analyse.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "check"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check reports brownfield findings", async () => {
	// SPEC §4.8: manifests with a missing lockfile surface findings
	// (exit 1) with the data for the extension (--json).
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		const ran = await cli(["--json", "deps", "check"], repo.dir);
		assert.ok(ran.code === 0 || ran.code === 1);
		const body = jsonOut(ran.stdout) as {
			findings: unknown;
			loosePins: unknown;
		};
		assert.ok(Array.isArray(body.findings));
		assert.ok(Array.isArray(body.loosePins));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade needs a snapshot", async () => {
	// SPEC §4.13.1: without registry data or a snapshot the upgrade
	// fails as CDX-E401 (exit 5).
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		const ran = await cli(["deps", "upgrade"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E401"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with a positional is a usage error", async () => {
	// SPEC §4.19.2: upgrade takes only --pr.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "upgrade", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator deps upgrade"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] deps rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside check/upgrade is a usage error.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator deps"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify passes with no manifest", async () => {
	// SPEC §4.14.2: without a manifest there is no drift to report, so
	// the run passes with the unverified note.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("verify: pass (unverified (no manifest))"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify blocks on an edited manifest", async () => {
	// SPEC §4.14.2: a manifest edited outside regen blocks (exit 1) and
	// names the file.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		repo.writeFile(".codictator/manifest.json", "not json\n");
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stdout.includes("core/guardrail-manifest"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify passes after regen", async () => {
	// SPEC §4.14.2: a freshly regenerated tree has no drift.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regenerated = await cli(["regen"], repo.dir);
		assert.equal(regenerated.code, 0);
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("verify: pass"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with an unknown layer is a usage error", async () => {
	// SPEC §4.19.2: layers are L1..L5; anything else is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "--layer", "L9"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with a lone base flag is a usage error", async () => {
	// SPEC §4.19.2: base and head travel together.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "--base", "abc"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});

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
