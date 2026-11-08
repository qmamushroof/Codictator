// SPEC §4.14.1 + §4.5.8 EC-12: the init plan renders every configured
// harness adapter's files, owned by that harness, and regen reproduces
// them byte for byte. In-process handler calls: assertions read the
// returned Result and the written tree, never stdout.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleRegen } from "../../../src/cli/guardrail.ts";
import { guardrailPlan, writePlan } from "../../../src/cli/plan.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { parseJson } from "../../../src/kernel/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(
	record: Record<string, unknown>,
	name: string,
): string | undefined {
	const found: unknown = record[name];
	return typeof found === "string" ? found : undefined;
}

function manifestArtifacts(repoDir: string): Array<Record<string, unknown>> {
	const raw = readFileSync(
		path.join(repoDir, ".codictator", "manifest.json"),
		"utf8",
	);
	const parsed = parseJson(raw);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return [];
	}
	if (!isRecord(parsed.value)) {
		assert.fail("manifest is not an object");
	}
	const artifactsKey = "artifacts";
	const artifacts: unknown = parsed.value[artifactsKey];
	assert.equal(Array.isArray(artifacts), true);
	if (!Array.isArray(artifacts)) {
		return [];
	}
	const rows: Array<Record<string, unknown>> = [];
	for (const entry of artifacts) {
		assert.equal(isRecord(entry), true);
		if (isRecord(entry)) {
			rows.push(entry);
		}
	}
	return rows;
}

function ownerOf(
	artifacts: ReadonlyArray<Record<string, unknown>>,
	artifactPath: string,
): string | undefined {
	for (const entry of artifacts) {
		if (textField(entry, "path") === artifactPath) {
			return textField(entry, "owner");
		}
	}
	return undefined;
}

test("[§4.14] guardrail plan renders harness adapter files owned by their harness", async () => {
	// SPEC §4.14.1: the manifest lists every generated artifact with its
	// owner (adapter, pack or module id). A plan for muse-code and opencode
	// therefore carries their hook and config files owned by the harness.
	const repo = createTempRepo();
	try {
		const wrote = await writePlan(
			repo.dir,
			guardrailPlan(
				["muse-code", "opencode"],
				"",
				path.basename(repo.dir),
				undefined,
			),
		);
		assert.equal(wrote.ok, true);
		const artifacts = manifestArtifacts(repo.dir);
		assert.equal(ownerOf(artifacts, ".muse/hooks.json"), "muse-code");
		assert.equal(ownerOf(artifacts, "opencode.json"), "opencode");
		assert.equal(
			ownerOf(artifacts, ".opencode/plugins/codictator.mjs"),
			"opencode",
		);
		assert.equal(
			readFileSync(path.join(repo.dir, ".muse", "hooks.json"), "utf8").length >
				0,
			true,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.5 EC-12] regen reproduces harness adapter files byte-identical", async () => {
	// SPEC §4.5.8 EC-12: regeneration with no config change is
	// byte-identical, harness files included. The second regen over the
	// written tree must reproduce every byte of the first. The lockfile
	// seed keeps setup detection on the plan defaults (no install
	// override), so the comparison judges regen fidelity, not detection;
	// lockfile-less detection is pinned by cli-workflow-setup instead.
	const repo = createTempRepo({ "package-lock.json": "{}" });
	try {
		const allHarnesses = [
			"muse-code",
			"universal",
			"claude-code",
			"copilot",
			"codex-cli",
			"cursor",
			"gemini-cli",
			"opencode",
		];
		const wrote = await writePlan(
			repo.dir,
			guardrailPlan(allHarnesses, "", path.basename(repo.dir), undefined),
		);
		assert.equal(wrote.ok, true);
		if (!wrote.ok) {
			return;
		}
		// SPEC §4.6.2 + core/guardrail-manifest: one row per path, so the
		// overlapping harness files (cursor/gemini-cli AGENTS.md,
		// codex-cli/muse-code .agents/skills) write each path once.
		assert.equal(
			new Set(wrote.value.map((entry) => entry.path)).size,
			wrote.value.length,
		);
		const before = new Map<string, string>();
		for (const entry of wrote.value) {
			before.set(
				entry.path,
				readFileSync(path.join(repo.dir, entry.path), "utf8"),
			);
		}
		assert.ok(before.has(".muse/hooks.json"));
		assert.ok(before.has("opencode.json"));
		const req: CommandRequest = {
			args: [],
			json: false,
			quiet: true,
			cwd: repo.dir,
			nodeVersion: undefined,
			stdinText: undefined,
		};
		const regenerated = await handleRegen(req);
		assert.equal(regenerated.ok, true);
		const after = new Map<string, string>();
		for (const artifactPath of before.keys()) {
			after.set(
				artifactPath,
				readFileSync(path.join(repo.dir, artifactPath), "utf8"),
			);
		}
		assert.deepEqual([...after.entries()], [...before.entries()]);
	} finally {
		repo.cleanup();
	}
});
