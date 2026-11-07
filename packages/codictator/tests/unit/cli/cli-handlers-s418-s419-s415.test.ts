import { strict as assert } from "node:assert";

import test from "node:test";

import {
	exitFor,
	nodeMajor,
	nodeTooOldMessage,
} from "../../../src/cli/shared.ts";

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
		seedEvent(repo, "evt-1", { codictator: "unknown" });
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
	// packages/codictator/tests/unit/cli/cli-handlers-s418-s419-s415.test.ts, reason: the
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
