import { strict as assert } from "node:assert";

import test from "node:test";

import {
	type CompletionRequest,
	createClient,
	isRetryableStatus,
	LLM_MAX_ATTEMPTS,
	LLM_RETRY_DELAYS_MS,
	type LlmPorts,
} from "../../../src/features/llm/index.ts";

import type { Net, NetRequest } from "../../../src/kernel/index.ts";

import { FakeClock } from "../../support/fake-clock.ts";

import { FakeEnv } from "../../support/fake-env.ts";

import { FakeNet } from "../../support/fake-net.ts";

function requestFor(): CompletionRequest {
	return {
		model: "muse-spark-1.3",
		prompt: "draft a forbid-pattern rule",
		maxOutputTokens: 1024,
	};
}

function configFor(): Record<string, unknown> {
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

function portsFor(
	net: Net,
	env: FakeEnv,
	clock: FakeClock,
	delays: Array<number>,
	withSleep = true,
): LlmPorts {
	const ports: LlmPorts = {
		net,
		env,
		clock,
	};
	if (!withSleep) {
		return ports;
	}
	return {
		...ports,
		sleep: (ms: number) => {
			delays.push(ms);
			clock.advanceMs(ms);
			return Promise.resolve();
		},
	};
}

function firstSent(sent: ReadonlyArray<NetRequest>): NetRequest {
	const first = sent[0];
	assert.ok(first !== undefined);
	return first;
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (ci/protection-read narrows the
// same way).
function headerOf(sent: NetRequest, name: string): string | undefined {
	return sent.headers[name];
}

test("[§4.17 EC-1] apiKeyEnv variable unset", async () => {
	// SPEC §4.17.4 EC-1: CDX-E852 naming the variable, before any request.
	const net = new FakeNet();
	const env = new FakeEnv();
	const delays: Array<number> = [];
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E852");
	assert.ok(responded.error.message.includes("MODEL_API_KEY"));
	assert.equal(net.requests.length, 0);
});

test("[§4.17 EC-2] provider returns 401", async () => {
	// SPEC §4.17.4 EC-2: CDX-E852; the key is never echoed.
	const net = new FakeNet();
	net.route("POST", "https://api.anthropic.com/v1/messages", {
		status: 401,
		headers: {},
		body: '{"error":{"message":"invalid x-api-key"}}',
	});
	const env = new FakeEnv({ ANTHROPIC_API_KEY: "secret-key-1" });
	const delays: Array<number> = [];
	const client = createClient(
		{
			provider: "anthropic",
			model: "claude-x",
			apiKeyEnv: "ANTHROPIC_API_KEY",
			timeoutMs: 30000,
			maxOutputTokens: 512,
		},
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete({
		model: "claude-x",
		prompt: "draft a forbid-pattern rule",
		maxOutputTokens: 512,
	});
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E852");
	assert.ok(!JSON.stringify(responded.error).includes("secret-key-1"));
	assert.equal(net.requests.length, 1);
	const sent = firstSent(net.requests);
	assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
	assert.equal(headerOf(sent, "x-api-key"), "secret-key-1");
	assert.equal(headerOf(sent, "anthropic-version"), "2023-06-01");
});

test("[§4.17 EC-3] provider returns 429", async () => {
	// SPEC §4.17.4 EC-3: retry twice with 2 s and 8 s backoff, then CDX-E854.
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/chat/completions", {
		status: 429,
		headers: {},
		body: "slow",
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-3" });
	const clock = new FakeClock();
	const delays: Array<number> = [];
	const client = createClient(configFor(), portsFor(net, env, clock, delays));
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E854");
	assert.equal(net.requests.length, LLM_MAX_ATTEMPTS);
	assert.deepEqual(delays, LLM_RETRY_DELAYS_MS);
	assert.deepEqual(delays, [2000, 8000]);
	assert.ok(responded.error.detail?.includes("3 attempts"));
	assert.ok(responded.error.detail?.includes("10000 ms"));
	assert.ok(!JSON.stringify(responded.error).includes("secret-key-3"));
	assert.equal(isRetryableStatus(429), true);
	assert.equal(isRetryableStatus(503), true);
	assert.equal(isRetryableStatus(400), false);
	const sent = firstSent(net.requests);
	assert.equal(headerOf(sent, "authorization"), "Bearer secret-key-3");
	assert.ok(sent.body?.includes("response_format"));
});
