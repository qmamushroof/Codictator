// SPEC §4.17.2: the two wire formats. Builders turn a narrowed config plus a
// completion request into a Net port request; readers pull the text (and the
// provider's stop signal) back out of a 200 body. Pure over caller-supplied
// strings, so the retry loop in index.ts stays small.
import { parseJson } from "../../kernel/index.ts";
import type { LlmConfig } from "./presets.ts";
import { isRecord } from "./presets.ts";

export interface WireRequest {
	readonly method: string;
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

export interface WireText {
	readonly text: string;
	readonly stopReason: string;
	readonly truncated: boolean;
}

export const ANTHROPIC_VERSION = "2023-06-01";

// Bracket access through a variable keeps
// noPropertyAccessFromIndexSignature satisfied without tripping
// useLiteralKeys (kernel narrows the same way).
function field(value: Record<string, unknown>, name: string): unknown {
	return value[name];
}

function isMetaHost(baseUrl: string): boolean {
	return new URL(baseUrl).hostname.toLowerCase() === "api.meta.ai";
}

function bearerHeaders(key: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (key !== undefined) {
		const authorizationKey = "authorization";
		headers[authorizationKey] = `Bearer ${key}`;
	}
	return headers;
}

// SPEC §4.17.2: openai-chat posts to {baseUrl}/chat/completions with a
// developer message, temperature 0 and (when supported) a json_object
// response_format. reasoning_effort rides along when set, but never "none"
// for Muse Spark, which rejects it.
export function buildOpenaiChatRequest(
	config: LlmConfig,
	model: string,
	prompt: string,
	maxTokens: number,
	key: string | undefined,
	withResponseFormat: boolean,
): WireRequest {
	const body: Record<string, unknown> = {
		model,
		messages: [{ role: "developer", content: prompt }],
		temperature: 0,
		max_tokens: maxTokens,
	};
	if (withResponseFormat) {
		const formatKey = "response_format";
		body[formatKey] = { type: "json_object" };
	}
	const effort = config.reasoningEffort;
	const isSpark = model.startsWith("muse-spark");
	if (effort !== undefined && !(isSpark && effort === "none")) {
		const effortKey = "reasoning_effort";
		body[effortKey] = effort;
	}
	return {
		method: "POST",
		url: `${config.baseUrl}/chat/completions`,
		headers: bearerHeaders(key),
		body: JSON.stringify(body),
	};
}

// SPEC §4.17.2: anthropic-messages posts to {baseUrl}/messages with a system
// prompt, a user message, max_tokens, the anthropic-version header and the
// key as x-api-key (Bearer for Meta).
export function buildAnthropicRequest(
	config: LlmConfig,
	model: string,
	prompt: string,
	maxTokens: number,
	key: string | undefined,
): WireRequest {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"anthropic-version": ANTHROPIC_VERSION,
	};
	if (key !== undefined) {
		if (isMetaHost(config.baseUrl)) {
			const authorizationKey = "authorization";
			headers[authorizationKey] = `Bearer ${key}`;
		} else {
			headers["x-api-key"] = key;
		}
	}
	return {
		method: "POST",
		url: `${config.baseUrl}/messages`,
		headers,
		body: JSON.stringify({
			model,
			system: prompt,
			messages: [{ role: "user", content: prompt }],
			max_tokens: maxTokens,
			temperature: 0,
		}),
	};
}

function readOpenaiText(parsed: unknown): WireText | undefined {
	if (!isRecord(parsed)) {
		return undefined;
	}
	const choices = field(parsed, "choices");
	if (!Array.isArray(choices)) {
		return undefined;
	}
	const first = choices[0];
	if (!isRecord(first)) {
		return undefined;
	}
	const message = field(first, "message");
	if (!isRecord(message)) {
		return undefined;
	}
	const content = field(message, "content");
	if (typeof content !== "string") {
		return undefined;
	}
	const reason = field(first, "finish_reason");
	const finishReason = typeof reason === "string" ? reason : "stop";
	return {
		text: content,
		stopReason: finishReason,
		truncated: finishReason === "length",
	};
}

function readAnthropicText(parsed: unknown): WireText | undefined {
	if (!isRecord(parsed)) {
		return undefined;
	}
	const content = field(parsed, "content");
	if (!Array.isArray(content)) {
		return undefined;
	}
	const parts: Array<string> = [];
	for (const block of content) {
		if (!isRecord(block)) {
			continue;
		}
		if (field(block, "type") !== "text") {
			continue;
		}
		const text = field(block, "text");
		if (typeof text !== "string") {
			continue;
		}
		parts.push(text);
	}
	if (parts.length === 0) {
		return undefined;
	}
	const reason = field(parsed, "stop_reason");
	const stopReason = typeof reason === "string" ? reason : "end_turn";
	return {
		text: parts.join(""),
		stopReason,
		truncated: stopReason === "max_tokens",
	};
}

// SPEC §4.17.2: pick the wire format from the narrowed config.
export function buildWireRequest(
	config: LlmConfig,
	model: string,
	prompt: string,
	maxTokens: number,
	key: string | undefined,
	withResponseFormat: boolean,
): WireRequest {
	return config.format === "openai-chat"
		? buildOpenaiChatRequest(
				config,
				model,
				prompt,
				maxTokens,
				key,
				withResponseFormat,
			)
		: buildAnthropicRequest(config, model, prompt, maxTokens, key);
}

// Read a 200 body per the configured format. Undefined means the provider
// answered something the format cannot carry, which the client reports as
// invalid JSON for the generator repair round (EC-7).
export function readWireText(
	format: LlmConfig["format"],
	body: string,
): WireText | undefined {
	const parsed = parseJson(body);
	if (!parsed.ok) {
		return undefined;
	}
	return format === "openai-chat"
		? readOpenaiText(parsed.value)
		: readAnthropicText(parsed.value);
}
