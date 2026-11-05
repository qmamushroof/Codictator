import { strict as assert } from "node:assert";

import test from "node:test";

import {
	type CompletionRequest,
	createClient,
	LLM_MAX_ATTEMPTS,
	type LlmPorts,
} from "../../../src/features/llm/index.ts";

import {
	type Net,
	type NetRequest,
	type NetResponse,
	ok,
	type Result,
} from "../../../src/kernel/index.ts";

import { FakeClock } from "../../support/fake-clock.ts";

import { FakeEnv } from "../../support/fake-env.ts";

import { FakeNet } from "../../support/fake-net.ts";

// FakeNet answers one scripted response per route, so the format-retry row
// (EC-6) and the malformed-body rows use this queue instead: same Net port,
// scripted response sequences, still no network and no waiting.
class QueueNet implements Net {
	private readonly queued: Array<Result<NetResponse>>;
	readonly sent: Array<NetRequest> = [];

	constructor(responses: ReadonlyArray<Result<NetResponse>>) {
		this.queued = [...responses];
	}

	request(req: NetRequest): Promise<Result<NetResponse>> {
		this.sent.push(req);
		const next = this.queued.shift();
		if (next === undefined) {
			throw new Error("QueueNet: no scripted response left");
		}
		return Promise.resolve(next);
	}
}

function jsonResponse(body: unknown, status = 200): Result<NetResponse> {
	return ok({ status, headers: {}, body: JSON.stringify(body) });
}

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

test("[§4.17.4] retryable statuses retry without an injected sleep", async () => {
	// The sleep port is optional (deps precedent): without it the client
	// still walks the attempts in order, just without waiting.
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/chat/completions", {
		status: 503,
		headers: {},
		body: "down",
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-nosleep" });
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), [], false),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E854");
	assert.equal(net.requests.length, LLM_MAX_ATTEMPTS);
});

test("[§4.17.4] keyless runtime rejection stays CDX-E852", async () => {
	// A keyless local runtime can still refuse the request; without an
	// apiKeyEnv there is no variable to name.
	const net = new FakeNet();
	net.route("POST", "http://127.0.0.1:11434/v1/chat/completions", {
		status: 401,
		headers: {},
		body: '{"error":{"message":"missing api key"}}',
	});
	const client = createClient(
		{
			provider: "openai-compatible",
			baseUrl: "http://127.0.0.1:11434/v1",
			format: "openai-chat",
			model: "local-model",
		},
		portsFor(net, new FakeEnv(), new FakeClock(), []),
	);
	const responded = await client.complete({
		model: "local-model",
		prompt: "draft a forbid-pattern rule",
		maxOutputTokens: 128,
	});
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E852");
	assert.equal(net.requests.length, 1);
});

test("[§4.17.4] plain 400 fails without a format retry", async () => {
	// EC-6 retries only when the 400 names response_format; any other 400
	// is CDX-E854 after the single attempt.
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/chat/completions", {
		status: 400,
		headers: {},
		body: '{"error":{"message":"bad messages"}}',
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-400" });
	const delays: Array<number> = [];
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E854");
	assert.equal(net.requests.length, 1);
	assert.deepEqual(delays, []);
});

test("[§4.17.4] second rejection after the format retry fails", async () => {
	// The response_format retry happens once; a second rejection is CDX-E854.
	const rejection = jsonResponse(
		{
			error: {
				message: "response_format is not supported here",
				type: "invalid_request_error",
			},
		},
		400,
	);
	const net = new QueueNet([rejection, rejection]);
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-retry" });
	const delays: Array<number> = [];
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E854");
	assert.equal(net.sent.length, 2);
	assert.deepEqual(delays, []);
});
