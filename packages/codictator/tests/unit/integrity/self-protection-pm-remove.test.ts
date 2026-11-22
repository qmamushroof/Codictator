import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { checkSelfProtection } from "../../../src/features/integrity/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

async function blocks(argv: ReadonlyArray<string>): Promise<boolean> {
	const findings = await checkSelfProtection(ctxFor(), argv);
	return findings.some((finding) => finding.ruleId === "core/no-bypass");
}

const REMOVE_VERBS: Readonly<Record<string, ReadonlyArray<string>>> = {
	npm: ["uninstall", "remove", "un", "rm", "r", "unlink"],
	pnpm: ["remove", "rm", "uninstall", "un"],
	yarn: ["remove"],
	bun: ["remove", "rm"],
};

test("[§4.14 EC-13] every package-manager removal shape of codictator blocks", async () => {
	// SPEC §4.14.3 Commands + EC-13: bare name and pinned name, every verb.
	for (const [pm, verbs] of Object.entries(REMOVE_VERBS)) {
		for (const verb of verbs) {
			for (const target of ["codictator", "codictator@1.0.0"]) {
				assert.equal(
					await blocks([pm, verb, target]),
					true,
					`${pm} ${verb} ${target}`,
				);
			}
		}
	}
});

test("[§4.14 EC-13] a wrapped package-manager removal blocks and names the engine", async () => {
	// SPEC §4.14.3: bash -c wrappers do not hide the removal.
	assert.equal(await blocks(["bash", "-c", "pnpm remove codictator"]), true);
	assert.equal(
		await blocks(["bash", "-c", "yarn remove codictator@1.0.0"]),
		true,
	);
	const findings = await checkSelfProtection(ctxFor(), [
		"bun",
		"rm",
		"codictator",
	]);
	assert.ok(
		findings.some((finding) =>
			finding.message.includes(
				"bun rm codictator removes the engine the gates run on",
			),
		),
	);
});

test("[§4.14 EC-14] installs, runs and removals of other packages do not block", async () => {
	// SPEC §4.14.3 EC-14: only codictator or codictator@<version> removal.
	for (const argv of [
		["npm", "uninstall", "left-pad"],
		["npm", "install", "codictator"],
		["npx", "codictator", "setup"],
		["pnpm", "remove", "left-pad"],
		["yarn", "remove", "left-pad"],
		["bun", "rm", "codictator-extras"],
		["yarn", "add", "codictator"],
	]) {
		assert.equal(await blocks(argv), false, argv.join(" "));
	}
});
