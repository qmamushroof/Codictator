// SPEC §4.17.1 and §4.16.5 EC-1: with no LLM preset configured, drafting
// through the real client factory fails CDX-E851 naming config.llm.provider,
// and a chosen preset's model reaches the request.
import { strict as assert } from "node:assert";
import test from "node:test";
import { draftPack } from "../../src/features/generator/index.ts";
import { createClient } from "../../src/features/llm/index.ts";
import { FakeClock } from "../support/fake-clock.ts";
import { FakeEnv } from "../support/fake-env.ts";
import { FakeNet } from "../support/fake-net.ts";

function ports() {
	return {
		net: new FakeNet(),
		env: new FakeEnv({ OPENAI_API_KEY: "test-key-value" }),
		clock: new FakeClock(),
	};
}

const input = {
	id: "custom-guard",
	description: "forbid a marker",
	sampleBefore: "marker()",
	sampleAfter: "safe()",
};

test("[§4.17.1] drafting with no preset configured fails CDX-E851", async () => {
	const drafted = await draftPack(input, {
		useLlm: true,
		llm: createClient({}, ports()),
	});
	assert.ok(!drafted.ok);
	assert.equal(drafted.error.code, "CDX-E851");
	assert.match(drafted.error.remediation, /config\.llm\.provider/);
});

test("[§4.17.1] drafting sends the model chosen in config, not a default", async () => {
	const p = ports();
	const client = createClient({ provider: "openai", model: "chosen-model" }, p);
	await draftPack(input, { useLlm: true, llm: client });
	const sent = p.net.requests[0];
	assert.ok(sent !== undefined);
	assert.match(String(sent.body), /"model":"chosen-model"/);
});
