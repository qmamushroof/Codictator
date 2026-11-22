// SPEC §4.17.1 and S24: no default preset and no default model. A block
// with no provider fails CDX-E851 naming config.llm.provider and the preset
// ids; presets are listed alphabetically; the model comes from the config.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as llm from "../../../src/features/llm/index.ts";
import { FakeClock } from "../../support/fake-clock.ts";
import { FakeEnv } from "../../support/fake-env.ts";
import { FakeNet } from "../../support/fake-net.ts";

test("[§4.17.1] a config with no provider fails CDX-E851 naming the choices", () => {
	const narrowed = llm.narrowLlmConfig({});
	assert.ok(!narrowed.ok);
	assert.equal(narrowed.error.code, "CDX-E851");
	const text = `${narrowed.error.message} ${narrowed.error.remediation}`;
	assert.match(text, /config\.llm\.provider/);
	for (const id of Object.keys(llm.LLM_PRESETS)) {
		assert.ok(text.includes(id), id);
	}
});

test("[§4.17.1] a client built with no provider answers CDX-E851 and sends nothing", async () => {
	const net = new FakeNet();
	const client = llm.createClient(
		{},
		{ net, env: new FakeEnv({}), clock: new FakeClock() },
	);
	const responded = await client.complete({
		model: "any",
		prompt: "p",
		maxOutputTokens: 16,
	});
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E851");
	assert.equal(net.requests.length, 0);
});

test("[§4.17.1] presets are listed alphabetically and none is a default", () => {
	assert.deepEqual(
		[...llm.LLM_PRESET_IDS],
		Object.keys(llm.LLM_PRESETS).sort(),
	);
	assert.ok(!("DEFAULT_PRESET_ID" in llm));
});

test("[§4.17.1] the client exposes the model from its config", () => {
	const ports = {
		net: new FakeNet(),
		env: new FakeEnv({}),
		clock: new FakeClock(),
	};
	const chosen = llm.createClient({ provider: "openai", model: "m-1" }, ports);
	assert.equal(chosen.model, "m-1");
	const none = llm.createClient({ provider: "openai" }, ports);
	assert.equal(none.model, undefined);
});
