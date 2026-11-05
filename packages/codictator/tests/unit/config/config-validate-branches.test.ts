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

test("[§4.2] unknown top-level key is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), extra: true })),
		"CDX-E101",
	);
});

test("[§4.2] version other than 1 is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), version: 2 })),
		"CDX-E101",
	);
});

test("[§4.2] non-string codictator field is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), codictator: 42 }),
		),
		"CDX-E101",
	);
});

test("[§4.2] engine version drift is CDX-E102", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), codictator: "9.9.9" }),
		),
		"CDX-E102",
	);
});

test("[§4.2] packs that are not an array is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), packs: {} })),
		"CDX-E101",
	);
});

test("[§4.2] pack without a string id is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), packs: [{ version: "1.0.0" }] }),
		),
		"CDX-E101",
	);
});

test("[§4.2] pack with an unknown key is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				packs: [{ id: "core", renamed: true }],
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] duplicate pack id is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				packs: [{ id: "core" }, { id: "core" }],
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] harnesses that are not an array is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), harnesses: "universal" }),
		),
		"CDX-E101",
	);
});

test("[§4.2] empty harnesses list is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), harnesses: [] })),
		"CDX-E101",
	);
});

test("[§4.2] empty harness entry is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), harnesses: [""] }),
		),
		"CDX-E101",
	);
});

test("[§4.2] unknown harness id is CDX-E301", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({ ...baseConfig(), harnesses: ["telepathy"] }),
		),
		"CDX-E301",
	);
});

test("[§4.2] custom harness id is accepted", () => {
	const effective = validateConfig({
		...baseConfig(),
		harnesses: ["custom:mine"],
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] tunables that are not an object is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() => validateConfig({ ...baseConfig(), tunables: [] })),
		"CDX-E101",
	);
});

test("[§4.2] tunable rule from an unloaded pack is CDX-E101", async () => {
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

test("[§4.2] unknown tunable rule on a loaded pack is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/not-a-rule": { params: {} } },
			}),
		),
		"CDX-E101",
	);
});
