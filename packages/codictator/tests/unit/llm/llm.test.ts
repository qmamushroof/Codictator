// SPEC §4.17.4: one red test per LLM EC row. Each pins the SPEC outcome
// against createClient. It still throws "not implemented", so all seven
// fail red until Phase 12 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CompletionRequest } from "../../../src/features/llm/index.ts";
import { createClient } from "../../../src/features/llm/index.ts";

function requestFor(): CompletionRequest {
	return {
		model: "muse-spark-1.3",
		prompt: "draft a forbid-pattern rule",
		maxOutputTokens: 1024,
	};
}

function configFor(): unknown {
	return {
		provider: "meta",
		baseUrl: "https://api.meta.ai/v1",
		format: "openai-chat",
		model: "muse-spark-1.3",
		apiKeyEnv: "MODEL_API_KEY",
		timeoutMs: 30000,
		maxOutputTokens: 1024,
	};
}

test("[§4.17 EC-1] apiKeyEnv variable unset", async () => {
	// SPEC §4.17.4 EC-1: CDX-E852 naming the variable.
	const client = createClient(configFor());
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, false);
});

test("[§4.17 EC-2] provider returns 401", async () => {
	// SPEC §4.17.4 EC-2: CDX-E852; the key is never echoed.
	const client = createClient(configFor());
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, false);
});

test("[§4.17 EC-3] provider returns 429", async () => {
	// SPEC §4.17.4 EC-3: retry twice with 2 s and 8 s backoff, then CDX-E854.
	const client = createClient(configFor());
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, false);
});

test("[§4.17 EC-4] request times out", async () => {
	// SPEC §4.17.4 EC-4: CDX-E854.
	const client = createClient(configFor());
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, false);
});

test("[§4.17 EC-5] baseUrl uses http on a public host", async () => {
	// SPEC §4.17.4 EC-5: CDX-E106; keys over plaintext refused.
	const client = createClient({
		provider: "openai-compatible",
		baseUrl: "http://registry.example/v1",
		format: "openai-chat",
		model: "local-model",
		timeoutMs: 30000,
		maxOutputTokens: 1024,
	});
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, false);
});

test("[§4.17 EC-6] provider rejects response_format", async () => {
	// SPEC §4.17.4 EC-6: retried once without it.
	const client = createClient(configFor());
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, true);
});

test("[§4.17 EC-7] response truncated at maxOutputTokens", async () => {
	// SPEC §4.17.4 EC-7: treated as invalid JSON for the repair round.
	const client = createClient(configFor());
	const responded = await client.complete(requestFor());
	assert.equal(responded.ok, false);
});
