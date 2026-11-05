import { strict as assert } from "node:assert";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { fileURLToPath } from "node:url";

import { runCommand } from "../../../src/cli/index.ts";

import { parseEvent } from "../../../src/features/adapters/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

function fixtureRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(
		here,
		"..",
		"..",
		"..",
		"fixtures",
		"harness",
		"custom",
		"acme",
		"0.0.0",
	);
}

function readPayload(): Record<string, unknown> {
	const envelope = JSON.parse(
		readFileSync(path.join(fixtureRoot(), "tool-pre-write.json"), "utf8"),
	) as {
		source: unknown;
		version: unknown;
		payload: Record<string, unknown>;
	};
	assert.equal(envelope.source, "custom:acme");
	assert.equal(envelope.version, "0.0.0");
	return envelope.payload;
}

function seedAcme(repoDir: string): void {
	const source = readFileSync(path.join(fixtureRoot(), "adapter.mjs"), "utf8");
	mkdirSync(path.join(repoDir, ".codictator", "adapters", "acme"), {
		recursive: true,
	});
	writeFileSync(
		path.join(repoDir, ".codictator", "adapters", "acme", "adapter.mjs"),
		source,
		"utf8",
	);
}

test("[§4.5.6] custom adapter without passing contract tests is inert with CDX-E302", async () => {
	// SPEC §4.5.6: custom:raw ships an adapter but never passed
	// `adapter test`, so every use stays inert with CDX-E302 (exit 3).
	// The adapter command knows no custom id yet and answers CDX-E301.
	const repo = createTempRepo();
	try {
		repo.writeFile(
			".codictator/adapters/raw/adapter.mjs",
			'export const adapter = { id: "custom:raw" };\n',
		);
		const result = await runCommand({
			argv: ["adapter", "test", "custom:raw"],
			cwd: repo.dir,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E302");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5.6] unknown custom adapter id fails with CDX-E301", async () => {
	// SPEC §4.5.6 + §8.1: an uninstalled custom id is CDX-E301 at the event
	// layer, not a throw. parseEvent currently throws for every custom id.
	const raw = { ...readPayload(), cwd: "/repo" };
	const result = parseEvent("custom:nope", "tool.pre.write", raw);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E301");
	}
});

test("[§4.5.6] adapter test custom:acme passes its contract", async () => {
	// SPEC §4.5.6: `adapter test custom:acme` runs the seeded adapter against
	// its shipped goldens (golden parse, render byte for byte, reply smoke),
	// so a verifying adapter exits 0 instead of staying inert with CDX-E302.
	const repo = createTempRepo();
	try {
		seedAcme(repo.dir);
		repo.writeFile(
			".codictator/adapters/acme/tool-pre-write.json",
			readFileSync(path.join(fixtureRoot(), "tool-pre-write.json"), "utf8"),
		);
		mkdirSync(
			path.join(repo.dir, ".codictator", "adapters", "acme", "render"),
			{
				recursive: true,
			},
		);
		writeFileSync(
			path.join(
				repo.dir,
				".codictator",
				"adapters",
				"acme",
				"render",
				"acme-hooks.json",
			),
			readFileSync(
				path.join(fixtureRoot(), "render", "acme-hooks.json"),
				"utf8",
			),
		);
		const result = await runCommand({
			argv: ["adapter", "test", "custom:acme"],
			cwd: repo.dir,
		});
		assert.equal(result.ok, true);
	} finally {
		repo.cleanup();
	}
});
