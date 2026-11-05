import { strict as assert } from "node:assert";

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { fileURLToPath } from "node:url";

import { handleRegen } from "../../../src/cli/guardrail.ts";

import { guardrailPlan, writePlan } from "../../../src/cli/plan.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import { loadCustomAdapter } from "../../../src/features/adapters/custom.ts";

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

function snapshotTree(dir: string): Map<string, string> {
	const files = new Map<string, string>();
	const walk = (current: string, prefix: string): void => {
		const entries = readdirSync(current, { withFileTypes: true }).sort(
			(a, b) => (a.name < b.name ? -1 : 1),
		);
		for (const entry of entries) {
			if (entry.name === ".git") {
				continue;
			}
			const full = path.join(current, entry.name);
			const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(full, relative);
			} else if (entry.isFile()) {
				files.set(relative, readFileSync(full, "utf8"));
			}
		}
	};
	walk(dir, "");
	return files;
}

function regenRequest(repoDir: string): CommandRequest {
	return {
		args: [],
		json: false,
		quiet: true,
		cwd: repoDir,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

test("[§4.5.6] custom adapter load parses the golden payload to the normalised event", async () => {
	// SPEC §4.5.6 + §7.8: loading custom:acme then parsing the golden payload
	// yields the normalised HookEvent (native name in event, remapped closed
	// trigger, session, write tool). The stub loader throws, so this fails red.
	const repo = createTempRepo();
	try {
		seedAcme(repo.dir);
		const loaded = await loadCustomAdapter(repo.dir, "acme");
		assert.equal(loaded.ok, true);
		if (!loaded.ok) {
			return;
		}
		const payload = { ...readPayload(), cwd: repo.dir };
		const parsed = loaded.value.parse("tool.pre.write", payload);
		assert.equal(parsed.ok, true);
		if (!parsed.ok) {
			return;
		}
		assert.equal(parsed.value.harness, "custom:acme");
		assert.equal(parsed.value.event, "beforeWrite");
		assert.equal(parsed.value.trigger, "pre-tool");
		assert.equal(parsed.value.sessionId, "sess-acme-0001");
		assert.equal(parsed.value.cwd, repo.dir);
		assert.equal(parsed.value.tool?.kind, "write");
		assert.deepEqual(parsed.value.tool?.paths, ["/repo/src/index.ts"]);
	} finally {
		repo.cleanup();
	}
});

test("[§4.5.6] custom adapter reply maps a block decision to the golden reply", async () => {
	// SPEC §4.5.6 + §4.5.1: replying block through custom:acme matches
	// fixtures/harness/custom/acme/0.0.0/reply-block.json byte for byte.
	const repo = createTempRepo();
	try {
		seedAcme(repo.dir);
		const loaded = await loadCustomAdapter(repo.dir, "acme");
		assert.equal(loaded.ok, true);
		if (!loaded.ok) {
			return;
		}
		const replied = loaded.value.reply({
			decision: "block",
			message: "acme says no",
			eventId: "evt-acme-1",
		});
		const golden = JSON.parse(
			readFileSync(path.join(fixtureRoot(), "reply-block.json"), "utf8"),
		) as { exitCode: number; stdout: string; stderr: string };
		assert.deepEqual(
			{
				exitCode: replied.exitCode,
				stdout: replied.stdout,
				stderr: replied.stderr,
			},
			golden,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.5.6] custom adapter render matches the golden files", async () => {
	// SPEC §4.5.6 + §10.2: render through custom:acme reproduces every file
	// under fixtures/harness/custom/acme/0.0.0/render/ by path and bytes.
	const repo = createTempRepo();
	try {
		seedAcme(repo.dir);
		const loaded = await loadCustomAdapter(repo.dir, "acme");
		assert.equal(loaded.ok, true);
		if (!loaded.ok) {
			return;
		}
		const parsed = loaded.value.parse("tool.pre.write", {
			...readPayload(),
			cwd: repo.dir,
		});
		assert.equal(parsed.ok, true);
		if (!parsed.ok) {
			return;
		}
		const artifacts = loaded.value.render({
			event: parsed.value,
			decision: { decision: "allow", eventId: "evt-acme-1" },
		});
		const goldenDir = path.join(fixtureRoot(), "render");
		const goldenFiles = readdirSync(goldenDir).sort();
		assert.ok(goldenFiles.length > 0);
		assert.deepEqual(
			artifacts.map((artifact) => artifact.path).sort(),
			goldenFiles,
		);
		for (const artifact of artifacts) {
			assert.equal(
				artifact.content,
				readFileSync(path.join(goldenDir, artifact.path), "utf8"),
			);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5.6] custom adapter regen is byte-identical", async () => {
	// SPEC §4.5.6 + §4.5.8 EC-12: with custom:acme configured, regen renders
	// the custom files, and a second regen over unchanged config reproduces
	// every file byte for byte. Regen knows no custom harness yet, so the
	// acme artifact assertion fails red.
	const repo = createTempRepo();
	try {
		seedAcme(repo.dir);
		const wrote = await writePlan(
			repo.dir,
			guardrailPlan(["custom:acme"], "", path.basename(repo.dir), undefined),
		);
		assert.ok(wrote.ok);
		const first = await handleRegen(regenRequest(repo.dir));
		assert.equal(first.ok, true);
		const before = snapshotTree(repo.dir);
		assert.ok(
			[...before.keys()].some(
				(relative) =>
					relative.includes("acme") &&
					!relative.startsWith(".codictator/adapters/"),
			),
			"regen renders at least one custom:acme artifact",
		);
		const second = await handleRegen(regenRequest(repo.dir));
		assert.equal(second.ok, true);
		assert.deepEqual(
			[...snapshotTree(repo.dir).entries()],
			[...before.entries()],
		);
	} finally {
		repo.cleanup();
	}
});
