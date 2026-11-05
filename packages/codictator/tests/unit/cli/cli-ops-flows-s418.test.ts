import { strict as assert } from "node:assert";

import test from "node:test";

import { handleRegen } from "../../../src/cli/guardrail.ts";

import { handleVerify } from "../../../src/cli/inspect.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import { handleExplain, handleReplay } from "../../../src/cli/transparency.ts";

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
