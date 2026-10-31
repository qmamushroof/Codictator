// SPEC §4.17.4: one test per LLM EC row. Each pins the SPEC outcome against
// createClient over the FakeNet stub and the FakeEnv/FakeClock ports, so no
// test reaches the public network (§10.2) or waits on a wall clock (§10.3):
// the injected sleep records backoff delays and advances the fake clock.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	type CompletionRequest,
	createClient,
	isRetryableStatus,
	LLM_MAX_ATTEMPTS,
	LLM_PRESETS,
	LLM_RETRY_DELAYS_MS,
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

test("[§4.17.1] presets default to the meta suggestion", async () => {
	// SPEC §4.17.1 and S24: an empty block resolves to the meta preset with
	// model muse-spark-1.3, and no preset selects a -contributor variant.
	for (const preset of Object.values(LLM_PRESETS)) {
		assert.ok(!preset.model.endsWith("-contributor"));
	}
	assert.equal(LLM_PRESETS.meta.model, "muse-spark-1.3");
	const net = new FakeNet();
	net.route("POST", "https://api.meta.ai/v1/chat/completions", {
		status: 200,
		headers: {},
		body: JSON.stringify({
			choices: [
				{
					message: { content: '{"rules":[]}' },
					finish_reason: "stop",
				},
			],
		}),
	});
	const env = new FakeEnv({ MODEL_API_KEY: "secret-key-default" });
	const delays: Array<number> = [];
	const client = createClient({}, portsFor(net, env, new FakeClock(), delays));
	const responded = await client.complete(requestFor());
	assert.ok(responded.ok);
	assert.equal(responded.value.stopReason, "stop");
	const sent = firstSent(net.requests);
	assert.equal(sent.url, "https://api.meta.ai/v1/chat/completions");
});

test("[§4.17.1] loopback http needs no key", async () => {
	// SPEC §4.17.1: the openai-compatible preset targets a local runtime, so
	// loopback http is allowed and no apiKeyEnv means no auth header.
	for (const baseUrl of [
		"http://127.0.0.1:11434/v1",
		"http://localhost:11434/v1",
	]) {
		for (const format of ["openai-chat", "anthropic-messages"] as const) {
			const net = new FakeNet();
			const path = format === "openai-chat" ? "/chat/completions" : "/messages";
			net.route("POST", `${baseUrl}${path}`, {
				status: 200,
				headers: {},
				body: JSON.stringify(
					format === "openai-chat"
						? { choices: [{ message: { content: "{}" } }] }
						: { content: [], stop_reason: "end_turn" },
				),
			});
			const client = createClient(
				{
					provider: "openai-compatible",
					baseUrl,
					format,
					model: "local-model",
				},
				portsFor(net, new FakeEnv(), new FakeClock(), []),
			);
			const responded = await client.complete({
				model: "local-model",
				prompt: "draft a forbid-pattern rule",
				maxOutputTokens: 128,
			});
			// Anthropic with no text blocks is invalid JSON for the repair
			// round; the openai-chat answer stops normally without a key.
			if (format === "openai-chat") {
				assert.ok(responded.ok);
				assert.equal(responded.value.stopReason, "stop");
			} else {
				assert.ok(!responded.ok);
				assert.equal(responded.error.code, "CDX-E853");
			}
			const sent = firstSent(net.requests);
			assert.equal(headerOf(sent, "authorization"), undefined);
			assert.equal(headerOf(sent, "x-api-key"), undefined);
		}
	}
});

test("[§4.17.1] empty key and bad shapes fail closed", async () => {
	// SPEC §4.17.1: an empty key counts as unset; every config shape
	// violation is CDX-E106 before any request.
	const cases: ReadonlyArray<{
		readonly name: string;
		readonly config: unknown;
		readonly env: Readonly<Record<string, string>>;
		readonly code: "CDX-E852" | "CDX-E106";
	}> = [
		{
			name: "empty key",
			config: configFor(),
			env: { MODEL_API_KEY: "" },
			code: "CDX-E852",
		},
		{
			name: "unknown provider",
			config: { provider: "nope" },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "literal key",
			config: { provider: "meta", apiKeyEnv: "sk-abc.def" },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "relative baseUrl",
			config: { provider: "meta", baseUrl: "not-a-url" },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "ftp baseUrl",
			config: { provider: "meta", baseUrl: "ftp://files.example/x" },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "bad timeout",
			config: { provider: "meta", timeoutMs: -5 },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "bad format",
			config: { provider: "meta", format: "stream" },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "empty baseUrl",
			config: { provider: "meta", baseUrl: "" },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "missing model",
			config: {
				provider: "openai-compatible",
				baseUrl: "http://127.0.0.1:11434/v1",
				model: "",
			},
			env: {},
			code: "CDX-E106",
		},
		{
			name: "zero maxOutputTokens",
			config: { provider: "meta", maxOutputTokens: 0 },
			env: {},
			code: "CDX-E106",
		},
		{
			name: "string config",
			config: "meta",
			env: {},
			code: "CDX-E106",
		},
		{
			name: "bad reasoningEffort",
			config: { provider: "meta", reasoningEffort: 42 },
			env: {},
			code: "CDX-E106",
		},
	];
	for (const kase of cases) {
		const net = new FakeNet();
		const client = createClient(
			kase.config,
			portsFor(net, new FakeEnv(kase.env), new FakeClock(), []),
		);
		const responded = await client.complete(requestFor());
		assert.ok(!responded.ok, kase.name);
		assert.equal(responded.error.code, kase.code, kase.name);
		assert.equal(net.requests.length, 0, kase.name);
	}
});

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
