// SPEC §4.19.2 + §4.13.1 + §4.14.5: init packs and helper tools, regen
// preservation. In-process handler calls: assertions read the returned
// Result, never stdout (the runner shares process.stdout with TAP).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateScope } from "../../../src/cli/evaluate.ts";
import { handleRegen } from "../../../src/cli/guardrail.ts";
import { handleInit } from "../../../src/cli/init.ts";
import { handleStatus, handleVerify } from "../../../src/cli/inspect.ts";
import { buildHelperTool, guardrailPlan } from "../../../src/cli/plan.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { validateConfig } from "../../../src/features/config/index.ts";
import { checkPattern } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
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

function readConfig(repoDir: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(`${repoDir}/.codictator/config.json`, "utf8"),
	) as Record<string, unknown>;
}

test("[§4.19] init with an unknown pack is a usage error", async () => {
	// SPEC §4.19.2: packs name built-in packs; anything else is a usage
	// error, checked before the human-only gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["--pack", "nope"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with a malformed tool is a usage error", async () => {
	// SPEC §4.19.2: tools read role=command@pin with a known helper role.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		for (const spec of ["lat", "role=command", "bogus-role=lat@1.2.3"]) {
			const ran = await handleInit(req(["--tool", spec], repo.dir));
			assert.equal(ran.ok, true);
			if (ran.ok) {
				assert.equal(ran.value, 2);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] guardrail plan carries packs, tools and the module map", async () => {
	// SPEC §4.13.1 + §4.4.5: packs pin built-ins at the engine version and
	// helper tools declare role, binary, exact pin, probe and pattern.
	const plan = guardrailPlan(["opencode"], "app", "repo", undefined, {
		packs: [
			{ id: "core", version: "0.0.0" },
			{ id: "typescript", version: "0.0.0" },
		],
		tools: [
			buildHelperTool({
				role: "knowledge-graph",
				command: "lat",
				pin: "0.13.3",
			}),
		],
		architecture: {
			profile: "app",
			modules: [{ name: "kernel", path: "src/kernel/**", dependsOn: [] }],
		},
	});
	const config = plan.files.find(
		(file) => file.path === ".codictator/config.json",
	);
	assert.ok(config !== undefined);
	const parsed = JSON.parse(config.content) as {
		packs: Array<{ id: string; version: string }>;
		tools: Array<unknown>;
		architecture: { profile: string; modules: Array<{ name: string }> };
	};
	assert.deepEqual(parsed.packs, [
		{ id: "core", version: "0.0.0" },
		{ id: "typescript", version: "0.0.0" },
	]);
	assert.equal(parsed.tools.length, 1);
	assert.doesNotThrow(() =>
		validateConfig({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["opencode"],
			tunables: {},
			tools: parsed.tools,
		}),
	);
	assert.equal(parsed.architecture.profile, "app");
	assert.equal(parsed.architecture.modules[0]?.name, "kernel");
});

test("[§4.4] helper tool entries carry a safe version pattern", () => {
	// SPEC §4.4.5: the probe pattern admits the kernel pattern safety check
	// and captures the pin from a semver-bearing version line.
	const entry = buildHelperTool({
		role: "knowledge-graph",
		command: "lat",
		pin: "0.13.3",
	}) as { version: { pattern: string } };
	const safe = checkPattern(entry.version.pattern);
	assert.equal(safe.ok, true);
	const matched = new RegExp(entry.version.pattern).exec("lat 0.13.3");
	assert.ok(matched !== null && matched[1] === "0.13.3");
});

test("[§4.14] regen preserves packs, tools and the architecture map", async () => {
	// SPEC §4.14.5: guardrails change only by changing config; regen keeps
	// every generator-owned section instead of resetting packs to [].
	const repo = createTempRepo({ "README.md": "hi", "package.json": "{}" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				packs: [{ id: "core", version: "0.0.0" }],
				harnesses: ["opencode"],
				tunables: {},
				architecture: {
					profile: "app",
					modules: [{ name: "kernel", path: "src/kernel/**", dependsOn: [] }],
				},
				tools: [
					buildHelperTool({
						role: "knowledge-graph",
						command: "lat",
						pin: "0.13.3",
					}),
				],
			}),
		);
		const before = readConfig(repo.dir);
		const regenerated = await handleRegen(req([], repo.dir));
		assert.equal(regenerated.ok, true);
		assert.deepEqual(readConfig(repo.dir), before);
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status names helper presence per required role", async () => {
	// SPEC §4.18.3 + §4.6.6: the screen shows each required helper role as
	// present with its binary and pin, or missing.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				packs: [],
				harnesses: ["opencode"],
				tools: [
					buildHelperTool({
						role: "knowledge-graph",
						command: "lat",
						pin: "0.13.3",
					}),
				],
			}),
		);
		const ran = await handleStatus(req([], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] verify passes with packs and helper tools declared", async () => {
	// Helper declarations are inert for the verdict: no external enforcer
	// binds them, so a declared helper never blocks verify.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [
				{ id: "core", version: "0.0.0" },
				{ id: "typescript", version: "0.0.0" },
			],
			harnesses: ["opencode"],
			tools: [
				buildHelperTool({
					role: "knowledge-graph",
					command: "lat",
					pin: "0.13.3",
				}),
			],
		}),
	});
	try {
		const result = await handleVerify(req([], repo.dir));
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] evaluateScope loads core once when config names it", async () => {
	// BUG-0010: the core pack is always loaded, so a config that names core
	// must not load it twice; every finding would double.
	const repo = createTempRepo({ "README.md": "hi", "NOTES.md": "# notes\n" });
	try {
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const result = await evaluateScope(
			ports.value,
			["core", "typescript"],
			{ trigger: "pre-tool", files: ["NOTES.md"], note: "test" },
			FIXED_INSTANT,
			"hash",
		);
		assert.equal(result.ok, true);
		if (!result.ok) {
			return;
		}
		const hits = result.value.filter(
			(finding) =>
				finding.ruleId === "core/doc-placement" && finding.path === "NOTES.md",
		);
		assert.equal(hits.length, 1);
	} finally {
		repo.cleanup();
	}
});
