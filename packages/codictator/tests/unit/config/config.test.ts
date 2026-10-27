// SPEC §4.2.4: one red test per config EC row. Error rows assert the SPEC
// error code through a throwing contract; success rows assert the frozen
// EffectiveConfig shape. loadConfig and validateConfig still throw
// "not implemented", so all eleven fail red until Phase 4 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Config } from "../../../src/features/config/index.ts";
import {
	loadConfig,
	validateConfig,
} from "../../../src/features/config/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function baseConfig(): Config {
	return {
		version: 1,
		codictator: "0.0.0",
		packs: [{ id: "core" }],
		harnesses: ["universal"],
		tunables: {},
		architecture: undefined,
		workflow: undefined,
		spec: undefined,
		testing: undefined,
		commands: {},
		steering: undefined,
		tools: [],
		security: undefined,
		deps: undefined,
		network: undefined,
		integrity: undefined,
		ci: undefined,
		llm: undefined,
	};
}

async function errorCodeOf(call: () => unknown): Promise<string> {
	try {
		await call();
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error) {
			const code: unknown = error.code;
			if (typeof code === "string") {
				return code;
			}
		}
		return "threw-without-code";
	}
	return "did-not-throw";
}

test("[§4.2 EC-1] missing config with a manifest blocks everything", async () => {
	const { fs } = createFakePorts();
	fs.seedText("package.json", '{"name": "repo"}');
	// SPEC §4.2.4 EC-1: CDX-E101; every layer blocks; fix codictator init --repair.
	assert.equal(
		await errorCodeOf(() => loadConfig("repo-with-manifest")),
		"CDX-E101",
	);
});

test("[§4.2 EC-2] missing config without a manifest is not a repo", async () => {
	// SPEC §4.2.4 EC-2: hooks exit allow silently, verify exits CDX-E108.
	assert.equal(await errorCodeOf(() => loadConfig("empty-dir")), "CDX-E108");
});

test("[§4.2 EC-3] tunable equal to the pack default", () => {
	// SPEC §4.2.4 EC-3: accepted.
	const effective = validateConfig({
		...baseConfig(),
		tunables: { "core/file-size": { params: { maxBytes: 65536 } } },
	});
	assert.equal(typeof effective.configHash, "string");
	assert.ok(effective.configHash.length > 0);
});

test("[§4.2 EC-4] tunable stricter than sensible stays accepted", () => {
	// SPEC §4.2.4 EC-4: tightening is free (PRD §6.1), even max file lines 1.
	const effective = validateConfig({
		...baseConfig(),
		tunables: { "core/file-size": { params: { maxLines: 1 } } },
	});
	assert.equal(typeof effective.configHash, "string");
	assert.ok(effective.configHash.length > 0);
});

test("[§4.2 EC-5] looser tunable belongs in a waiver", async () => {
	// SPEC §4.2.4 EC-5: CDX-E102 is version drift; looser-in-tunables is CDX-E104.
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/file-size": { params: { maxBytes: 999999999 } } },
			}),
		),
		"CDX-E104",
	);
});

test("[§4.2 EC-6] floor rule under tunables", async () => {
	// SPEC §4.2.4 EC-6: CDX-E103 and an integrity event.
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/no-bypass": { params: {} } },
			}),
		),
		"CDX-E103",
	);
});

test("[§4.2 EC-7] duplicate pack id at two versions", async () => {
	// SPEC §4.2.4 EC-7: CDX-E101.
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				packs: [{ id: "typescript" }, { id: "typescript", version: "9.9.9" }],
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2 EC-8] config edit beside a baseline raise", () => {
	// SPEC §4.2.4 EC-8: both changes are reported; the raise still fails
	// per §4.3.5. The config itself loads here.
	const effective = validateConfig({
		...baseConfig(),
		tunables: { "core/file-size": { params: { maxBytes: 4096 } } },
	});
	assert.equal(typeof effective.configHash, "string");
	assert.ok(effective.configHash.length > 0);
});

test("[§4.2 EC-9] rule id from an unloaded pack", async () => {
	// SPEC §4.2.4 EC-9: CDX-E101 naming the pack.
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "dotnet/no-banned-api": { params: {} } },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2 EC-10] human-only command under an agent marker", async () => {
	const { env } = createFakePorts({
		env: { CODICTATOR_HOOK: "1" },
	});
	assert.equal(env.get("CODICTATOR_HOOK"), "1");
	// SPEC §4.2.4 EC-10: a TTY is required; hooks and CI get CDX-E107.
	assert.equal(await errorCodeOf(() => loadConfig("repo")), "CDX-E107");
});

test("[§4.2 EC-11] engine upgraded without bumping config", async () => {
	// SPEC §4.2.4 EC-11: CDX-E102 with the one-line fix.
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), codictator: "0.0.1-older" }),
		),
		"CDX-E102",
	);
});
