// SPEC §4.2.1 + §7.15 D6: the engine version fallback. An unreadable
// manifest leaves ENGINE_VERSION unknown; a config pinning the old
// "0.0.0" placeholder no longer validates against it.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	ENGINE_VERSION,
	validateConfig,
} from "../../../src/features/config/index.ts";

test("[§4.2] unknown engine version renders unknown, never 0.0.0", () => {
	// SPEC §4.2.1: the built entry resolves the installed version from its
	// own manifest; the placeholder survives only when unreadable, and it
	// reads "unknown".
	assert.equal(ENGINE_VERSION, "unknown");
	const effective = validateConfig(
		{
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["opencode"],
			tunables: {},
		},
		ENGINE_VERSION,
	);
	assert.equal(effective.config.codictator, "unknown");
});

test("[§4.2] the 0.0.0 placeholder no longer validates", () => {
	// The old placeholder is not the engine version: pinning it fails
	// CDX-E102 with the remediation naming the installed version.
	let code = "did-not-throw";
	try {
		validateConfig(
			{
				version: 1,
				codictator: "0.0.0",
				packs: [],
				harnesses: ["opencode"],
				tunables: {},
			},
			ENGINE_VERSION,
		);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error) {
			code = String(error.code);
		} else {
			code = "threw-without-code";
		}
	}
	assert.equal(code, "CDX-E102");
});
