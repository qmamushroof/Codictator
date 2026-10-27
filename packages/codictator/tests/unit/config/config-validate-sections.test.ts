// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the Phase 4 red rows in
// config.test.ts stay listed until Phase 4 lands. Covers SPEC §4.2.2
// workflow, architecture, tools and llm validation branches against the pure
// validateConfig contract: no ports, no I/O.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Config } from "../../../src/features/config/index.ts";
import { validateConfig } from "../../../src/features/config/index.ts";

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

const FULL_PHASES = [
	"discovery",
	"planning",
	"implementation",
	"validation",
	"review",
	"record",
	"integrate",
].map((name) => ({ name }));

test("[§4.2] workflow that is not an object is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), workflow: [] })),
		"CDX-E101",
	);
});

test("[§4.2] workflow phases that are not an array is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), workflow: { phases: {} } }),
		),
		"CDX-E101",
	);
});

test("[§4.2] workflow phase without a string name is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), workflow: { phases: [{}] } }),
		),
		"CDX-E101",
	);
});

test("[§4.2] workflow with only custom phases is accepted", () => {
	const effective = validateConfig({
		...baseConfig(),
		workflow: { phases: [{ name: "custom:explore" }] },
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] workflow reordering mandatory phases is CDX-E105", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				workflow: {
					phases: [{ name: "implementation" }, { name: "planning" }],
				},
			}),
		),
		"CDX-E105",
	);
});

test("[§4.2] workflow removing a mandatory phase is CDX-E105", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				workflow: { phases: [{ name: "discovery" }, { name: "planning" }] },
			}),
		),
		"CDX-E105",
	);
});

test("[§4.2] workflow with all mandatory phases in order is accepted", () => {
	const effective = validateConfig({
		...baseConfig(),
		workflow: { phases: FULL_PHASES },
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] architecture that is not an object is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), architecture: [] }),
		),
		"CDX-E101",
	);
});

test("[§4.2] unknown architecture profile is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				architecture: { profile: "monolith" },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] architecture modules that are not an array is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), architecture: { modules: {} } }),
		),
		"CDX-E101",
	);
});

test("[§4.2] architecture module without a string name is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				architecture: { modules: [{ dependsOn: [] }] },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] architecture module cycle is CDX-E105", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				architecture: {
					modules: [
						{ name: "a", dependsOn: ["b"] },
						{ name: "b", dependsOn: ["a"] },
					],
				},
			}),
		),
		"CDX-E105",
	);
});

test("[§4.2] architecture module with a non-array dependsOn is accepted", () => {
	const effective = validateConfig({
		...baseConfig(),
		architecture: { profile: "app", modules: [{ name: "a", dependsOn: 42 }] },
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] tools that are not an array is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), tools: {} })),
		"CDX-E101",
	);
});

test("[§4.2] tool entry that is not an object is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), tools: ["tool"] }),
		),
		"CDX-E101",
	);
});

test("[§4.2] tool without an exact version pin is CDX-E206", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), tools: [{ name: "tool" }] }),
		),
		"CDX-E206",
	);
});

test("[§4.2] tool with an empty version pin is CDX-E206", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tools: [{ name: "tool", version: { pin: "" } }],
			}),
		),
		"CDX-E206",
	);
});

test("[§4.2] llm that is not an object is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), llm: [] })),
		"CDX-E101",
	);
});

test("[§4.2] literal secret under llm is CDX-E106", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				llm: { apiKey: "literal-secret-value" },
			}),
		),
		"CDX-E106",
	);
});

test("[§4.2] env-var reference suffix under llm skips the secret check", () => {
	const effective = validateConfig({
		...baseConfig(),
		llm: { apiKeyEnv: "MY_API_KEY" },
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] non-secret llm key skips the secret check", () => {
	const effective = validateConfig({
		...baseConfig(),
		llm: { model: "large" },
	});
	assert.equal(typeof effective.configHash, "string");
});
