// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the Phase 4 red rows in
// config.test.ts stay listed until Phase 4 lands. Covers SPEC §4.2.3
// requireHuman branches with the fake Env: no I/O, no TTY probing.
import { strict as assert } from "node:assert";
import test from "node:test";
import { requireHuman } from "../../../src/features/config/index.ts";
import { FakeEnv } from "../../support/fake-env.ts";

test("[§4.2] human-only command under the hook marker is CDX-E107", () => {
	const env = new FakeEnv({ CODICTATOR_HOOK: "1" });
	assert.throws(
		() => requireHuman(env, true),
		(error: unknown) => {
			return (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "CDX-E107"
			);
		},
	);
});

test("[§4.2] human-only command under a configured agent marker is CDX-E107", () => {
	const env = new FakeEnv({ AGENT_MARKER: "1" });
	assert.throws(
		() => requireHuman(env, true, ["AGENT_MARKER"]),
		(error: unknown) => {
			return (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "CDX-E107"
			);
		},
	);
});

test("[§4.2] human-only command without a TTY is CDX-E107", () => {
	const env = new FakeEnv({});
	assert.throws(
		() => requireHuman(env, false),
		(error: unknown) => {
			return (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "CDX-E107"
			);
		},
	);
});

test("[§4.2] human-only command passes with a TTY and no markers", () => {
	const env = new FakeEnv({});
	requireHuman(env, true);
});

test("[§4.2] empty agent marker value is ignored", () => {
	const env = new FakeEnv({ AGENT_MARKER: "" });
	requireHuman(env, true, ["AGENT_MARKER"]);
});

test("[§4.2] unset agent marker is ignored", () => {
	const env = new FakeEnv({});
	requireHuman(env, true, ["AGENT_MARKER"]);
});
