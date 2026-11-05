import { strict as assert } from "node:assert";

import test from "node:test";

import {
	type CompletionRequest,
	createClient,
	LLM_PRESETS,
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
