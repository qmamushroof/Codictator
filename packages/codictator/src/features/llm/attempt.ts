// SPEC §4.17.4: one answered attempt and its classification. Kept apart so
// the factory and the retry loop stay under the size and complexity guards.
import {
	type Env,
	err,
	type NetResponse,
	ok,
	type Result,
} from "../../kernel/index.ts";
import {
	invalidDraftError,
	keyMissingError,
	keyRejectedError,
	unavailableError,
} from "./errors.ts";
import type {
	CompletionRequest,
	CompletionResponse,
	LlmPorts,
} from "./index.ts";
import type { LlmConfig } from "./presets.ts";
import { buildWireRequest, readWireText } from "./wire.ts";

export const LLM_MAX_ATTEMPTS = 3;

// SPEC §4.17.4 EC-3: retry twice with 2 s and 8 s backoff.
export const LLM_RETRY_DELAYS_MS: ReadonlyArray<number> = [2000, 8000];

const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

// SPEC §4.17.4 EC-3: 429 and 5xx are retryable; every other status fails at
// once (401/403 become CDX-E852, the rest CDX-E854).
export function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status <= 599);
}

// SPEC §4.17.4 EC-6: a 400 that names response_format means the provider
// rejected the json_object hint, so the one retry goes without it.
function rejectsResponseFormat(body: string): boolean {
	return body.toLowerCase().includes("response_format");
}

// Read the key at call time; an empty value counts as unset (EC-1).
export function resolveKey(
	env: Env,
	keyName: string | undefined,
): Result<string | undefined> {
	if (keyName === undefined) {
		return ok(undefined);
	}
	const raw = env.get(keyName);
	const key = raw === undefined || raw === "" ? undefined : raw;
	if (key === undefined) {
		return err(keyMissingError(keyName));
	}
	return ok(key);
}

function readBody(
	config: LlmConfig,
	response: NetResponse,
): Result<CompletionResponse> {
	const read = readWireText(config.format, response.body);
	if (read === undefined) {
		return err(
			invalidDraftError(`provider answer is not ${config.format} JSON`),
		);
	}
	// SPEC §4.17.4 EC-7: a draft cut at maxOutputTokens is invalid JSON for
	// the generator repair round.
	if (read.truncated) {
		return err(
			invalidDraftError(
				`response truncated at maxOutputTokens (stop: ${read.stopReason})`,
			),
		);
	}
	return ok({ text: read.text, stopReason: read.stopReason });
}

export type Advance =
	| { readonly kind: "return"; readonly result: Result<CompletionResponse> }
	| { readonly kind: "strip-format" }
	| { readonly kind: "backoff"; readonly delayMs: number };

// Classify one answered attempt: finish now, strip the format hint once, or
// back off and retry.
function advance(
	ports: LlmPorts,
	config: LlmConfig,
	response: NetResponse,
	withResponseFormat: boolean,
	attempt: number,
	started: string,
): Advance {
	if (AUTH_STATUSES.has(response.status)) {
		return {
			kind: "return",
			result: err(keyRejectedError(response.status, config.apiKeyEnv)),
		};
	}
	if (
		withResponseFormat &&
		response.status === 400 &&
		rejectsResponseFormat(response.body)
	) {
		return { kind: "strip-format" };
	}
	if (isRetryableStatus(response.status)) {
		if (attempt + 1 < LLM_MAX_ATTEMPTS) {
			const delays = LLM_RETRY_DELAYS_MS;
			return {
				kind: "backoff",
				delayMs: delays[Math.min(attempt, delays.length - 1)] ?? 8000,
			};
		}
		const elapsed = Date.parse(ports.clock.now()) - Date.parse(started);
		return {
			kind: "return",
			result: err(
				unavailableError(
					`status ${String(response.status)} after ${String(LLM_MAX_ATTEMPTS)} attempts over ${String(elapsed)} ms`,
				),
			),
		};
	}
	if (response.status !== 200) {
		return {
			kind: "return",
			result: err(unavailableError(`status ${String(response.status)}`)),
		};
	}
	return { kind: "return", result: readBody(config, response) };
}

// One attempt: send the wire request and classify the answer.
export async function runAttempt(
	ports: LlmPorts,
	config: LlmConfig,
	req: CompletionRequest,
	key: string | undefined,
	withResponseFormat: boolean,
	attempt: number,
	started: string,
): Promise<Advance> {
	const wire = buildWireRequest(
		config,
		req.model,
		req.prompt,
		req.maxOutputTokens,
		key,
		withResponseFormat,
	);
	const sent = await ports.net.request({
		method: wire.method,
		url: wire.url,
		headers: wire.headers,
		body: wire.body,
		timeoutMs: config.timeoutMs,
	});
	// SPEC §4.17.4 EC-4: a transport failure (including a timeout at the Net
	// port) is CDX-E854 at once, never a retry.
	if (!sent.ok) {
		return {
			kind: "return",
			result: err(unavailableError(`request failed: ${sent.error.message}`)),
		};
	}
	return advance(
		ports,
		config,
		sent.value,
		withResponseFormat,
		attempt,
		started,
	);
}
