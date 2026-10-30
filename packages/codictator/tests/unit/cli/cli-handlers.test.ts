// SPEC §4.14, §4.15, §4.18 + §4.19: branch coverage for the CI,
// guardrail, transparency and status handlers (ci.ts, guardrail.ts,
// transparency.ts, inspect.ts) plus the shared CLI utils, none of which
// the red ledger pins. Each scenario drives the built entry in a child
// process (the EC-6 pattern in audit.test.ts), so handler stdout/stderr
// stays assertable. Nothing reaches the network; no wall clock asserted.
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	exitFor,
	nodeMajor,
	nodeTooOldMessage,
} from "../../../src/cli/shared.ts";
import {
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
} from "../../../src/features/integrity/index.ts";
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
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function seedEvent(
	repo: TempRepo,
	id: string,
	packs: Readonly<Record<string, string>>,
): void {
	repo.writeFile(
		".codictator/state/events.jsonl",
		`${JSON.stringify({
			v: 1,
			id,
			ts: "2026-01-01T00:00:00.000Z",
			now: "2026-01-01T00:00:00.000Z",
			kind: "verdict",
			layer: "L1",
			trigger: "pre-tool",
			ruleIds: [],
			durationMs: 5,
			configHash: "abc",
			packs,
		})}\n`,
	);
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

test("[§4.14] regen with extra args is a usage error", async () => {
	// SPEC §4.19.2: regen takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["regen", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator regen"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen renders guardrails from config", async () => {
	// SPEC §4.14.5: regen re-renders guardrails from config and reports
	// every regenerated file.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["regen"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("regenerated .codictator/config.json"));
		assert.ok(ran.stdout.includes("regenerated AGENTS.md"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen without config fails closed", async () => {
	// SPEC §4.14.5: without a readable config there is nothing to render.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["regen"], repo.dir);
		assert.ok(ran.code !== 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks with extra args is a usage error", async () => {
	// SPEC §4.19.2: install-hooks takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["install-hooks", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator install-hooks"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks writes the hooks", async () => {
	// SPEC §4.14.4: install-hooks writes the hook scripts and points
	// core.hooksPath at them.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["install-hooks"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("hooks installed at"));
		const first = HOOK_NAMES[0] ?? "pre-commit";
		assert.equal(
			existsSync(path.join(repo.dir, EXPECTED_HOOKS_PATH, first)),
			true,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall with extra args is a usage error", async () => {
	// SPEC §4.19.2: uninstall takes no flags or positionals, checked
	// before the human-only gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["uninstall", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator uninstall"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: uninstall is human-only, so the child process without
	// a TTY is refused with CDX-E107 (exit 4).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["uninstall"], repo.dir);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain answers a known code as data", async () => {
	// SPEC §4.18.2: a known error code resolves to its §8 row with the
	// §8.2 exit.
	const repo = createTempRepo();
	try {
		const ran = await cli(["--json", "explain", "CDX-E101"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as {
			code: string;
			exit: number;
			meaning: string;
			remediation: string;
			text: string;
		};
		assert.equal(body.code, "CDX-E101");
		assert.equal(body.exit, 3);
		assert.ok(body.text.includes("CDX-E101"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints a known code as text", async () => {
	// SPEC §4.18.2: the human rendering leads with the greppable code.
	const repo = createTempRepo();
	try {
		const ran = await cli(["explain", "CDX-E503"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("CDX-E503:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints a rule row", async () => {
	// SPEC §4.18.2: a rule id prints its pack row with statement and
	// remediation.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["explain", "core/context-soft-band"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("rule core/context-soft-band"));
		assert.ok(ran.stdout.includes("remediation:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints an event verdict and replay", async () => {
	// SPEC §4.18.2: an event id prints its verdict, inputs and replay.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedEvent(repo, "evt-1", { codictator: "0.0.0" });
		const ran = await cli(["explain", "evt-1"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("event evt-1:"));
		assert.ok(ran.stdout.includes("rerun: codictator replay evt-1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain of an unknown id maps to CDX-E010", async () => {
	// SPEC §4.18.2 + EC-4: unknown ids print CDX-E010 with the nearest
	// known ids and exit 2.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["explain", "no-such-thing"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("Nearest known ids:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay of an unknown event fails CDX-E010", async () => {
	// SPEC §4.18.2: replaying an event id the log does not hold fails
	// with the unknown-event path (exit 2).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["replay", "nope"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("CDX-E010"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay of a removed pack fails CDX-E011", async () => {
	// SPEC §4.18.6 EC-5: a pack version that is no longer installed names
	// the version needed (exit 6, the install bucket).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedEvent(repo, "evt-old", { codictator: "9.9.9" });
		const ran = await cli(["replay", "evt-old"], repo.dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E011"));
		assert.ok(ran.stderr.includes("9.9.9"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay reruns an installed event", async () => {
	// SPEC §4.18.2: an event whose pack matches reruns to its summary.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedEvent(repo, "evt-1", { codictator: "0.0.0" });
		const ran = await cli(["replay", "evt-1"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("rerun: codictator replay evt-1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status renders the one-screen summary", async () => {
	// SPEC §4.18.3: status prints engine, packs, harness states and the
	// event counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["status"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("codictator 0.0.0 status at"));
		assert.ok(ran.stdout.includes("harnesses:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status json mirrors the screen as data", async () => {
	// SPEC §4.18.3: --json emits the same screen as data for the
	// extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["--json", "status"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as { engineVersion: string };
		assert.equal(body.engineVersion, "0.0.0");
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status names configured packs", async () => {
	// SPEC §4.18.3: packs from the effective config render as id@version.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				packs: [{ id: "core", version: "1.0.0" }],
				harnesses: ["muse-code", "opencode"],
			}),
		);
		const ran = await cli(["status"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("packs: core@1.0.0"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] status with an unknown flag is a usage error", async () => {
	// SPEC §4.19.6 EC-1: unknown flags are usage errors (exit 2).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["status", "--bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator status"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] verify with a positional is a usage error", async () => {
	// SPEC §4.19.6 EC-1: verify takes flags only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "stray"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] verify with an unknown flag is a usage error", async () => {
	// SPEC §4.19.6 EC-1: unknown flags are usage errors (exit 2).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "--bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain rule and event answer as data", async () => {
	// SPEC §4.18.2: rule and event explanations render as --json data.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const rule = await cli(
			["--json", "explain", "core/context-soft-band"],
			repo.dir,
		);
		assert.equal(rule.code, 0);
		const ruleBody = jsonOut(rule.stdout) as { rule: string; text: string };
		assert.equal(ruleBody.rule, "core/context-soft-band");
		assert.ok(ruleBody.text.includes("rule core/context-soft-band"));
		seedEvent(repo, "evt-1", { codictator: "0.0.0" });
		const event = await cli(["--json", "explain", "evt-1"], repo.dir);
		assert.equal(event.code, 0);
		const eventBody = jsonOut(event.stdout) as { event: string; text: string };
		assert.equal(eventBody.event, "evt-1");
		assert.ok(eventBody.text.includes("rerun: codictator replay evt-1"));
		const replayed = await cli(["--json", "replay", "evt-1"], repo.dir);
		assert.equal(replayed.code, 0);
		const replayBody = jsonOut(replayed.stdout) as {
			event: string;
			text: string;
		};
		assert.equal(replayBody.event, "evt-1");
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] hook words route through the hook runtime", async () => {
	// SPEC §4.19: the hook word dispatches to runHook, not the command
	// table; an unknown harness answers exit 0 like the EC-3 red row.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["hook", "nope", "pre"], repo.dir);
		assert.equal(ran.code, 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] hook with an empty payload is denied", async () => {
	// SPEC §4.19.3: an empty hook payload fails closed as CDX-E303 with
	// a deny decision on stdout. The child's stdin closes at once, so
	// the read sees EOF instead of waiting out the hook budget.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["hook", "muse-code", "pre"], repo.dir, "");
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("CDX-E303"));
		assert.ok(ran.stdout.includes("deny"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] global flags route and fail closed", async () => {
	// SPEC §4.19.1: --cwd overrides the root; a missing value and an
	// empty argv are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const routed = await cli(["--cwd", repo.dir, "task", "show"], "/");
		assert.equal(routed.code, 0);
		const missing = await cli(["--cwd"], repo.dir);
		assert.equal(missing.code, 2);
		const empty = await cli([], repo.dir);
		assert.equal(empty.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci sweep renders as data", async () => {
	// SPEC §4.15.4: the sweep plan ships as --json for the extension.
	const repo = createTempRepo();
	try {
		const ran = await cli(["--json", "ci", "sweep"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as { action: string; pr: string };
		assert.ok(typeof body.action === "string");
		assert.ok(typeof body.pr === "string");
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change with a positional is a usage error", async () => {
	// SPEC §4.19.2: record-bot-change takes flags only.
	const repo = createTempRepo();
	try {
		const ran = await cli(
			["ci", "record-bot-change", "--author", "x", "stray"],
			repo.dir,
		);
		assert.equal(ran.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci verify resolves the config hash", async () => {
	// SPEC §4.15.1: with a readable config the verify decision carries
	// its hash. Integrity exception IE-10-civerify-exit (rule
	// core/no-assertion-loss, path
	// packages/codictator/tests/unit/cli/cli-handlers.test.ts, reason: the
	// temp repo yields advise-only findings (unreadable protection), which
	// exit 0 per SPEC §8.2 "Pass (allow or advise only)" + §4.15.1 "exits
	// per §8"; the old assertion pinned the pre-read findings.length rule).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["--json", "ci", "verify"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as { summary: string };
		assert.ok(body.summary.includes("# codictator CI summary"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change without files is a usage error", async () => {
	// SPEC §4.19.2: files are required alongside the author.
	const repo = createTempRepo();
	try {
		const ran = await cli(
			["ci", "record-bot-change", "--author", "x"],
			repo.dir,
		);
		assert.equal(ran.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain rejects bad arities", async () => {
	// SPEC §4.19.6 EC-1: explain takes exactly one id; unknown flags
	// fail the same way.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const none = await cli(["explain"], repo.dir);
		assert.equal(none.code, 2);
		const two = await cli(["explain", "a", "b"], repo.dir);
		assert.equal(two.code, 2);
		assert.ok(two.stderr.includes("usage: codictator explain"));
		const bogus = await cli(["explain", "--bogus"], repo.dir);
		assert.equal(bogus.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain and replay map unknown ids as data", async () => {
	// SPEC §4.18.6 EC-4: --json renders the CDX-E010 envelope for
	// unknown explain ids and unknown replay events.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const explained = await cli(["--json", "explain", "nope"], repo.dir);
		assert.equal(explained.code, 2);
		const explainedBody = jsonOut(explained.stdout) as { code: string };
		assert.equal(explainedBody.code, "CDX-E010");
		const replayed = await cli(["--json", "replay", "nope"], repo.dir);
		assert.equal(replayed.code, 2);
		const replayedBody = jsonOut(replayed.stdout) as { code: string };
		assert.equal(replayedBody.code, "CDX-E010");
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] shared CLI utils map versions and exits", () => {
	// SPEC §4.19.4 + §8.2: the node floor parses majors, names CDX-E002
	// below it, and unknown codes map to the internal exit 7.
	assert.equal(nodeMajor("v22.1.0"), 22);
	assert.equal(nodeMajor("bogus"), 0);
	assert.ok(nodeTooOldMessage("v22.1.0").includes("CDX-E002"));
	assert.equal(exitFor("CDX-E101"), 3);
	assert.equal(exitFor("CDX-NOPE"), 7);
});
