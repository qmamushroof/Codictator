import { strict as assert } from "node:assert";

import test from "node:test";

import {
	type CompletionRequest,
	createClient,
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

test("[§4.17.2] anthropic-messages concatenates text blocks", async () => {
	// SPEC §4.17.2: the meta-messages preset authenticates with Bearer and
	// the reader concatenates every text content block.
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/messages", {
		status: 200,
		headers: {},
		body: JSON.stringify({
			content: [
				{ type: "text", text: '{"a":' },
				{ type: "text", text: "1}" },
			],
			stop_reason: "end_turn",
		}),
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-msg" });
	const delays: Array<number> = [];
	const client = createClient(
		{ provider: "meta-messages", timeoutMs: 30000, maxOutputTokens: 256 },
		portsFor(net, env, new FakeClock(), delays),
	);
	const responded = await client.complete({
		model: "muse-spark-1.3",
		prompt: "draft a forbid-pattern rule",
		maxOutputTokens: 256,
	});
	assert.ok(responded.ok);
	assert.equal(responded.value.text, '{"a":1}');
	assert.equal(responded.value.stopReason, "end_turn");
	const sent = firstSent(net.requests);
	assert.equal(headerOf(sent, "authorization"), "Bearer secret-key-msg");
	assert.equal(headerOf(sent, "x-api-key"), undefined);
	assert.equal(headerOf(sent, "anthropic-version"), "2023-06-01");
});

test("[§4.17.2] anthropic truncation and malformed bodies fail CDX-E853", async () => {
	// SPEC §4.17.4 EC-7 for the messages format, plus the reader's shape
	// guards: anything the format cannot carry is invalid JSON.
	const bodies: ReadonlyArray<unknown> = [
		"42",
		"null",
		"[]",
		"{}",
		{ content: [] },
		{ content: [null] },
		{ content: [{ type: "image" }] },
		{ content: [{ type: "text" }] },
		{
			content: [{ type: "text", text: '{"a":1}' }],
			stop_reason: "max_tokens",
		},
	];
	const net = new QueueNet(
		bodies.map((body) =>
			typeof body === "string"
				? ok({ status: 200, headers: {}, body })
				: jsonResponse(body),
		),
	);
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-mal" });
	const client = createClient(
		{ provider: "meta-messages", timeoutMs: 30000, maxOutputTokens: 256 },
		portsFor(net, env, new FakeClock(), []),
	);
	for (let index = 0; index < bodies.length; index += 1) {
		const responded = await client.complete({
			model: "muse-spark-1.3",
			prompt: "draft a forbid-pattern rule",
			maxOutputTokens: 256,
		});
		assert.ok(!responded.ok, `body ${String(index)}`);
		assert.equal(responded.error.code, "CDX-E853", `body ${String(index)}`);
	}
	assert.equal(net.sent.length, bodies.length);
});

test("[§4.17.2] openai malformed bodies fail CDX-E853", async () => {
	// SPEC §4.17.4 EC-7 for the chat format: every shape the reader cannot
	// carry is invalid JSON; a body without finish_reason stops normally.
	const bodies: ReadonlyArray<unknown> = [
		"oops",
		"42",
		"null",
		"[]",
		"{}",
		{ choices: [] },
		{ choices: [null] },
		{ choices: [{ message: null }] },
		{ choices: [{ message: {} }] },
	];
	const net = new QueueNet([
		...bodies.map((body) =>
			typeof body === "string"
				? ok({ status: 200, headers: {}, body })
				: jsonResponse(body),
		),
		jsonResponse({ choices: [{ message: { content: "{}" } }] }),
	]);
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-chat" });
	const client = createClient(
		configFor(),
		portsFor(net, env, new FakeClock(), []),
	);
	for (let index = 0; index < bodies.length; index += 1) {
		const responded = await client.complete(requestFor());
		assert.ok(!responded.ok, `body ${String(index)}`);
		assert.equal(responded.error.code, "CDX-E853", `body ${String(index)}`);
	}
	const last = await client.complete(requestFor());
	assert.ok(last.ok);
	assert.equal(last.value.stopReason, "stop");
	assert.equal(net.sent.length, bodies.length + 1);
});

test("[§4.17.2] reasoning_effort is omitted for Muse Spark none", async () => {
	// SPEC §4.17.2: reasoning_effort rides along when set, but never "none"
	// for Muse Spark, which rejects it.
	const success = {
		choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
	};
	const net = new QueueNet([
		jsonResponse(success),
		jsonResponse(success),
		jsonResponse(success),
	]);
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-reason" });
	const base = portsFor(net, env, new FakeClock(), []);
	const sparkNone = createClient(
		{ ...configFor(), reasoningEffort: "none" },
		base,
	);
	const sparkLow = createClient(
		{ ...configFor(), reasoningEffort: "low" },
		base,
	);
	const otherNone = createClient(
		{
			provider: "openai",
			model: "other-model",
			apiKeyEnv: "MODEL_API_KEY",
			reasoningEffort: "none",
		},
		base,
	);
	assert.ok((await sparkNone.complete(requestFor())).ok);
	assert.ok(
		(await sparkLow.complete({ ...requestFor(), model: "muse-spark-1.3" })).ok,
	);
	assert.ok(
		(
			await otherNone.complete({
				...requestFor(),
				model: "other-model",
			})
		).ok,
	);
	assert.equal(net.sent.length, 3);
	const first = net.sent[0];
	const second = net.sent[1];
	const third = net.sent[2];
	assert.ok(first !== undefined && second !== undefined && third !== undefined);
	assert.ok(!first.body?.includes("reasoning_effort"));
	assert.ok(second.body?.includes('"reasoning_effort":"low"'));
	assert.ok(third.body?.includes('"reasoning_effort":"none"'));
});
