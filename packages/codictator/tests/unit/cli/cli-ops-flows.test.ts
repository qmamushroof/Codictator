// SPEC §4.8 + §4.13 + §4.14.2 + §4.15 + §4.18 + §4.19: dependency,
// drift, remediation, CI, transparency, report, status and dispatch
// remainders. In-process handler calls: assertions read the returned
// Result, never stdout (the runner shares process.stdout with TAP).
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { handleCi } from "../../../src/cli/ci.ts";
import { handleDeps } from "../../../src/cli/deps.ts";
import { handleRegen } from "../../../src/cli/guardrail.ts";
import { runCommand } from "../../../src/cli/index.ts";
import { handleStatus, handleVerify } from "../../../src/cli/inspect.ts";
import { main } from "../../../src/cli/main.ts";
import { handleRemediate } from "../../../src/cli/remediation.ts";
import { handleContext, handleReport } from "../../../src/cli/report.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { handleExplain, handleReplay } from "../../../src/cli/transparency.ts";
import { manifestHash } from "../../../src/features/integrity/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function seedConfig(repo: {
	writeFile: (rel: string, content: string) => void;
}): void {
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

function outside(prefix: string): string {
	return mkdtempSync(path.join(tmpdir(), prefix));
}

test("[§4.8] deps check prints findings as human text", async () => {
	// SPEC §4.8: the human rendering lists each finding with remediation.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({
				name: "x",
				version: "0.0.0",
				dependencies: { leftpad: "1.3.0" },
			}),
		);
		const ran = await handleDeps(req(["check"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check with no findings reports the clean tree", async () => {
	// SPEC §4.8: a manifest set with nothing to flag names the clean tree.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "y", version: "0.0.0" }),
		);
		repo.writeFile(
			"package-lock.json",
			JSON.stringify({
				name: "y",
				version: "0.0.0",
				lockfileVersion: 3,
				packages: { "": { name: "y", version: "0.0.0" } },
			}),
		);
		const ran = await handleDeps(req(["check"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade without manifests fails CDX-E903", async () => {
	// SPEC §4.8: upgrade collects manifests before reading any snapshot.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleDeps(req(["upgrade"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with a snapshot plans the pins", async () => {
	// SPEC §4.13.1: the snapshot stands in for registry data offline.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({
				name: "x",
				version: "0.0.0",
				dependencies: { leftpad: "^1.0.0" },
			}),
		);
		repo.writeFile(".codictator/registry-snapshot.json", "{}\n");
		const ran = await handleDeps(req(["upgrade"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade plans with --pr as data", async () => {
	// SPEC §4.8.6: --pr marks the planned upgrade for a pull request.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({
				name: "x",
				version: "0.0.0",
				dependencies: { leftpad: "^1.0.0" },
			}),
		);
		repo.writeFile(".codictator/registry-snapshot.json", "{}\n");
		const ran = await handleDeps(req(["upgrade", "--pr"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify passes a freshly rendered tree", async () => {
	// SPEC §4.14.2: regen writes a self-consistent manifest, so verify passes.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the decision with findings and note.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleVerify(req([], repo.dir, true));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify scopes drift to a layer", async () => {
	// SPEC §4.14.2: the layer flag scopes the manifest note.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleVerify(req(["--layer", "L2"], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with an unknown layer is a usage error", async () => {
	// SPEC §4.19.2: the layer is one of L1 through L5.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleVerify(req(["--layer", "L9"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with half a base range is a usage error", async () => {
	// SPEC §4.19.2: --base and --head travel together.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleVerify(req(["--base", "abc"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify names a tampered artifact", async () => {
	// SPEC §4.14.2: an artifact whose bytes drifted from its manifest
	// entry blocks with the file named.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		repo.writeFile("AGENTS.md", "# tampered\n");
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify names a missing artifact", async () => {
	// SPEC §4.14.2: an artifact the manifest names but the tree lacks fails.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const { rmSync } = await import("node:fs");
		rmSync(path.join(repo.dir, "AGENTS.md"));
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify refuses an edited manifest", async () => {
	// SPEC §4.14.2: a manifest edited outside regen fails its self-hash.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const { readFileSync } = await import("node:fs");
		const manifestPath = path.join(repo.dir, ".codictator/manifest.json");
		const text = readFileSync(manifestPath, "utf8").replace(
			"codictator",
			"codictatoR",
		);
		repo.writeFile(".codictator/manifest.json", text);
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify skips non-record manifest entries", async () => {
	// SPEC §4.14.2: entries that are not records cannot name a file.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const artifacts = [
			{
				path: ".codictator/config.json",
				owner: "codictator",
				mode: "file",
				hash: "0".repeat(64),
			},
			"junk",
			{ path: 7 },
		];
		repo.writeFile(
			".codictator/manifest.json",
			`${JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				artifacts,
				hash: manifestHash(artifacts as never),
			})}\n`,
		);
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan without a baseline plans zero steps", async () => {
	// SPEC §4.13: with no baseline the planner emits an empty plan.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan tolerates a scalar baseline", async () => {
	// SPEC §4.13: a baseline that is not a record falls back to empty.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(".codictator/baseline.json", "42\n");
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan tolerates entries that are not a record", async () => {
	// SPEC §4.13: entries that are not a record fall back to empty.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/baseline.json",
			`${JSON.stringify({ version: 1, entries: 7 })}\n`,
		);
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan with extra args is a usage error", async () => {
	// SPEC §4.19.2: plan takes no positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["plan", "extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status without a plan fails CDX-E903", async () => {
	// SPEC §4.13: status reads the plan the plan step wrote.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["status"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status of a corrupt plan fails CDX-E903", async () => {
	// SPEC §4.13: a plan that is not a plan asks for a fresh plan run.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(".codictator/remediation-plan.json", "not json\n");
		const ran = await handleRemediate(req(["status"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate next of an empty plan is complete", async () => {
	// SPEC §4.13: with every step done (vacuously) the plan is complete.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const ran = await handleRemediate(req(["next"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate next answers as data with --json", async () => {
	// SPEC §4.19.2: remediate status ships done and total counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const ran = await handleRemediate(req(["status"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run without an id is a usage error", async () => {
	// SPEC §4.19.2: run names the step id.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const ran = await handleRemediate(req(["run"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run of a gated step fails CDX-E608", async () => {
	// SPEC §4.13.4: a step without gate evidence refuses to run.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			`${JSON.stringify({
				version: 1,
				steps: [{ id: "S-0001", status: "pending" }],
			})}\n`,
		);
		const ran = await handleRemediate(req(["run", "S-0001"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E608");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run of a done step reports the run", async () => {
	// SPEC §4.13.4: a done step needs no gates and reports exit 1 with
	// the gate-evidence reminder.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			`${JSON.stringify({
				version: 1,
				steps: [{ id: "S-0002", status: "done" }],
			})}\n`,
		);
		const ran = await handleRemediate(req(["run", "S-0002"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run of an unknown step throws", async () => {
	// SPEC §4.13.4: an unknown step id has no step to gate, so the run
	// throws instead of verdicting (fail-closed at the entry).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			`${JSON.stringify({
				version: 1,
				steps: [{ id: "S-0001", status: "pending" }],
			})}\n`,
		);
		await assert.rejects(
			handleRemediate(req(["run", "S-9999"], repo.dir)),
			/unknown remediation step S-9999/,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci sweep with extra args is a usage error", async () => {
	// SPEC §4.19.2: sweep takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["sweep", "extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci sweep answers as data with --json", async () => {
	// SPEC §4.15: the sweep verdict ships the planned action and PR.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["sweep"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable record flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["record-bot-change", "--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change from a fork needs no write", async () => {
	// SPEC §4.15.7: fork PRs qualify but never take the write commit.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(
			req(
				[
					"record-bot-change",
					"--author",
					"renovate[bot]",
					"--files",
					"package-lock.json",
					"--fork",
				],
				repo.dir,
			),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci verify on a shallow clone blocks closed", async () => {
	// SPEC §4.15.1 EC-2: an unreachable base fails closed with the summary.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		writeFileSync(path.join(repo.dir, ".git", "shallow"), "abc\n");
		const ran = await handleCi(req(["verify"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside verify/sweep/record-bot-change
	// is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain with two ids is a usage error", async () => {
	// SPEC §4.19.2: explain takes exactly one id.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleExplain(req(["a", "b"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable explain flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleExplain(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain of an unknown id answers as data", async () => {
	// SPEC §4.18.2: --json ships the CDX-E010 envelope with the row text.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleExplain(req(["no-such-thing"], repo.dir, true));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E010");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints a parametrized rule row", async () => {
	// SPEC §4.18.2: a rule with parameters lists defaults and bounds.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleExplain(req(["core/file-size"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain of a missing rule scans every pack", async () => {
	// SPEC §4.18.2: an id no loaded pack owns falls to the CDX-E010 path.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleExplain(req(["core/no-such-rule"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E010");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints the second matching event", async () => {
	// SPEC §4.18.2: the event scan skips lines until the id matches.
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
				ruleIds: [],
				durationMs: 5,
				configHash: "abc",
				packs: { codictator: "0.0.0" },
			})}\n${JSON.stringify({
				v: 1,
				id: "evt-2",
				ts: "2026-01-01T00:00:00.000Z",
				now: "2026-01-01T00:00:00.000Z",
				kind: "verdict",
				layer: "L2",
				trigger: "pre-tool",
				ruleIds: [],
				durationMs: 6,
				configHash: "abc",
				packs: { codictator: "0.0.0" },
			})}\n`,
		);
		const ran = await handleExplain(req(["evt-2"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay without an id replays all", async () => {
	// SPEC §4.19.2: bare `replay` (no event id) replays the whole event log
	// and returns the verify-equivalent verdict.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const replayed = await handleReplay(req([], repo.dir));
		const verified = await handleVerify(req([], repo.dir));
		assert.equal(replayed.ok, true);
		assert.equal(verified.ok, true);
		if (replayed.ok && verified.ok) {
			assert.equal(replayed.value, verified.value);
			assert.equal(replayed.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable replay flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReplay(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] report with a positional is a usage error", async () => {
	// SPEC §4.19.2: report takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReport(req(["extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] context with a positional is a usage error", async () => {
	// SPEC §4.19.2: context takes only --all.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleContext(req(["extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] context outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: context resolves the repo root first.
	const dir = outside("codictator-nocontext-");
	try {
		const ran = await handleContext(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.18] context with --all and no config names the gap", async () => {
	// SPEC §4.6.3: without a readable config the hash reads unknown.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleContext(req(["--all"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] context with --all and config names the hash", async () => {
	// SPEC §4.6.3: --all appends the config hash and harness list.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleContext(req(["--all"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: status resolves the repo root before reading the log.
	const dir = outside("codictator-nostatus-");
	try {
		const ran = await handleStatus(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.19] dispatch rejects --cwd without a value", async () => {
	// SPEC §4.19.6: a --cwd with no path is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({ argv: ["--cwd"], cwd: repo.dir });
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] dispatch honours --cwd equals form", async () => {
	// SPEC §4.19.1: --cwd=<path> scopes the command to that root.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({
			argv: [`--cwd=${repo.dir}`, "status"],
			cwd: repo.dir,
		});
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] dispatch refuses an old Node", async () => {
	// SPEC §4.19.4: the node floor fails as CDX-E002 on any runner.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({
			argv: ["status"],
			cwd: repo.dir,
			nodeVersion: "v22.0.0",
		});
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E002");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] the built entry usage-errors on no command", async () => {
	// SPEC §4.19: the engine entry prints usage with exit 2 and no word.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const code = await main([], repo.dir);
		assert.equal(code, 2);
	} finally {
		repo.cleanup();
	}
});
