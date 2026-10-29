// SPEC §4.14.1 + §4.14.5: the init plan and a regen over the written
// config produce byte-identical guardrail sets, with or without a profile,
// so regeneration reproduces the manifest byte for byte.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleRegen } from "../../src/cli/guardrail.ts";
import { guardrailPlan, writePlan } from "../../src/cli/plan.ts";
import type { CommandRequest } from "../../src/cli/shared.ts";
import { createTempRepo } from "../support/temp-repo.ts";

function snapshot(
	dir: string,
	paths: ReadonlyArray<string>,
): Map<string, string> {
	const bytes = new Map<string, string>();
	for (const relative of [...paths, ".codictator/manifest.json"].sort()) {
		bytes.set(relative, readFileSync(`${dir}/${relative}`, "utf8"));
	}
	return bytes;
}

async function writeInit(repoDir: string, profile: string): Promise<void> {
	const harnesses = ["muse-code", "opencode"];
	const repoName = path.basename(repoDir);
	const wrote = await writePlan(
		repoDir,
		guardrailPlan(harnesses, profile, repoName, undefined),
	);
	assert.ok(wrote.ok);
}

async function writeRegen(repoDir: string): Promise<void> {
	// Drives the real regen command: harnesses and profile come from the
	// written config, user text from the written AGENTS.md.
	const req: CommandRequest = {
		args: [],
		json: false,
		quiet: true,
		cwd: repoDir,
		nodeVersion: undefined,
		stdinText: undefined,
	};
	const regenerated = await handleRegen(req);
	assert.equal(regenerated.ok, true);
}

test("[§4.14] init then regen is byte-identical", async () => {
	// SPEC §4.14.1: regen on unchanged config reproduces every artifact
	// byte for byte.
	const repo = createTempRepo();
	try {
		await writeInit(repo.dir, "");
		const before = snapshot(repo.dir, [
			".codictator/config.json",
			"AGENTS.md",
			".github/workflows/codictator.yml",
			".githooks/pre-commit",
			".githooks/commit-msg",
			".githooks/pre-push",
			".githooks/.gitattributes",
			".codictator/bin/run.mjs",
		]);
		await writeRegen(repo.dir);
		const after = snapshot(
			repo.dir,
			[...before.keys()].filter(
				(entry) => entry !== ".codictator/manifest.json",
			),
		);
		assert.deepEqual([...after.entries()], [...before.entries()]);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen preserves the init profile", async () => {
	// SPEC §4.14.5: guardrails change only by changing config; a profile
	// chosen at init survives regeneration instead of dropping out of the
	// rewritten config.
	const repo = createTempRepo();
	try {
		await writeInit(repo.dir, "app");
		const config = JSON.parse(
			readFileSync(`${repo.dir}/.codictator/config.json`, "utf8"),
		) as { architecture?: { profile?: string } };
		assert.equal(config.architecture?.profile, "app");
		const before = snapshot(repo.dir, [
			".codictator/config.json",
			"AGENTS.md",
			".github/workflows/codictator.yml",
			".githooks/pre-commit",
			".githooks/commit-msg",
			".githooks/pre-push",
			".githooks/.gitattributes",
			".codictator/bin/run.mjs",
		]);
		await writeRegen(repo.dir);
		const after = snapshot(
			repo.dir,
			[...before.keys()].filter(
				(entry) => entry !== ".codictator/manifest.json",
			),
		);
		assert.deepEqual([...after.entries()], [...before.entries()]);
		const kept = JSON.parse(
			readFileSync(`${repo.dir}/.codictator/config.json`, "utf8"),
		) as { architecture?: { profile?: string } };
		assert.equal(kept.architecture?.profile, "app");
	} finally {
		repo.cleanup();
	}
});
