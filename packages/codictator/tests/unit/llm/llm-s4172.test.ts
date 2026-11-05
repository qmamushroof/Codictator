import { strict as assert } from "node:assert";

import test from "node:test";

import {
	type CompletionRequest,
	createClient,
	type LlmPorts,
} from "../../../src/features/llm/index.ts";

import type { Net } from "../../../src/kernel/index.ts";

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

test("[§4.17.2] provider returns 403", async () => {
	// SPEC §4.17.4 EC-2 covers 401/403; the 403 half rejects the key too.
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/chat/completions", {
		status: 403,
		headers: {},
		body: '{"error":{"message":"forbidden"}}',
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-403" });
	const delays: Array<number> = [];
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E852");
	assert.ok(!JSON.stringify(responded.error).includes("secret-key-403"));
});
