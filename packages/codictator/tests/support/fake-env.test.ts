// SPEC §10.2: self-test for the in-memory Env support.
import { strict as assert } from "node:assert";
import test from "node:test";
import { FakeEnv } from "./fake-env.ts";

test("[§10.2] fake env reads seeded values and misses unknown names", () => {
	const env = new FakeEnv({ CODICTATOR_PROFILE: "strict" });
	assert.equal(env.get("CODICTATOR_PROFILE"), "strict");
	assert.equal(env.get("MISSING"), undefined);
});

test("[§10.2] fake env sets and removes values per test", () => {
	const env = new FakeEnv();
	env.set("API_KEY", "secret");
	assert.equal(env.get("API_KEY"), "secret");
	env.remove("API_KEY");
	assert.equal(env.get("API_KEY"), undefined);
});
