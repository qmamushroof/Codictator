import { strict as assert } from "node:assert";

import test from "node:test";

import {
	type CompletionRequest,
	createClient,
	type LlmPorts,
} from "../../../src/features/llm/index.ts";

import {
	makeError,
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

function firstSent(sent: ReadonlyArray<NetRequest>): NetRequest {
	const first = sent[0];
	assert.ok(first !== undefined);
	return first;
}

test("[§4.17 EC-4] request times out", async () => {
	// SPEC §4.17.4 EC-4: a transport timeout at the Net port is CDX-E854 at
	// once, never a retry.
	const net = new FakeNet();
	net.routeError(
		"POST",
		"https://api.meta.ai/v1/chat/completions",
		makeError(
			"CDX-E702",
			"network request to api.meta.ai timed out",
			"Retry with a larger timeout.",
		),
	);
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-4" });
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

test("[§4.17 EC-5] baseUrl uses http on a public host", async () => {
	// SPEC §4.17.4 EC-5: CDX-E106; keys over plaintext refused, no request.
	const net = new FakeNet();
	const env = new FakeEnv();
	const delays: Array<number> = [];
	const client = createClient(
		{
			provider: "openai-compatible",
			baseUrl: "http://registry.example/v1",
			format: "openai-chat",
			model: "local-model",
			timeoutMs: 30000,
			maxOutputTokens: 1024,
		},
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E106");
	assert.equal(net.requests.length, 0);
});

test("[§4.17 EC-6] provider rejects response_format", async () => {
	// SPEC §4.17.4 EC-6: retried once without it.
	const success = {
		choices: [
			{
				message: { content: '{"rules":[]}' },
				finish_reason: "stop",
			},
		],
	};
	const net = new QueueNet([
		jsonResponse(
			{
				error: {
					message: "Unsupported parameter: response_format is not supported",
					type: "invalid_request_error",
				},
			},
			400,
		),
		jsonResponse(success),
	]);
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-6" });
	const delays: Array<number> = [];
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(responded.ok);
	assert.equal(responded.value.text, '{"rules":[]}');
	assert.equal(net.sent.length, 2);
	assert.ok(firstSent(net.sent).body?.includes("response_format"));
	const retried = net.sent[1];
	assert.ok(retried !== undefined);
	assert.ok(!retried.body?.includes("response_format"));
	assert.deepEqual(delays, []);
});

test("[§4.17 EC-7] response truncated at maxOutputTokens", async () => {
	// SPEC §4.17.4 EC-7: treated as invalid JSON for the repair round.
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/chat/completions", {
		status: 200,
		headers: {},
		body: JSON.stringify({
			choices: [
				{
					message: { content: '{"rules":[' },
					finish_reason: "length",
				},
			],
		}),
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-7" });
	const delays: Array<number> = [];
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete(requestFor());
	assert.ok(!responded.ok);
	assert.equal(responded.error.code, "CDX-E853");
	assert.equal(net.requests.length, 1);
});
