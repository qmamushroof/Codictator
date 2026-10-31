// SPEC §4.17: provider-agnostic completion client. Only generator and cli
// may import this module (§3.3 hard boundary); no enforcement path does.
import {
	type Clock,
	type Env,
	err,
	type Net,
	type Result,
} from "../../kernel/index.ts";
import { type Advance, resolveKey, runAttempt } from "./attempt.ts";
import { type LlmConfig, narrowLlmConfig } from "./presets.ts";

export {
	isRetryableStatus,
	LLM_MAX_ATTEMPTS,
	LLM_RETRY_DELAYS_MS,
} from "./attempt.ts";
export type { LlmFormat, LlmPresetId } from "./presets.ts";
export {
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_PRESET_ID,
	DEFAULT_TIMEOUT_MS,
	LLM_PRESETS,
	narrowLlmConfig,
} from "./presets.ts";

export interface CompletionRequest {
	readonly model: string;
	readonly prompt: string;
	readonly maxOutputTokens: number;
}

export interface CompletionResponse {
	readonly text: string;
	readonly stopReason: string;
}

export interface LlmClient {
	readonly complete: (
		req: CompletionRequest,
	) => Promise<Result<CompletionResponse>>;
}

// Ports the client needs. Net and Env carry the request and the key; Clock
// stamps attempt durations; sleep waits out backoff without a wall clock in
// tests (CONVENTIONS: injected Clock, no real sleeps).
export interface LlmPorts {
	readonly net: Net;
	readonly env: Env;
	readonly clock: Clock;
	readonly sleep?: (ms: number) => Promise<void>;
}

// The retry loop lives outside the factory so neither function trips the
// size guard; narrowing still happens once at construction.
async function runComplete(
	narrowed: Result<LlmConfig>,
	ports: LlmPorts,
	req: CompletionRequest,
): Promise<Result<CompletionResponse>> {
	if (!narrowed.ok) {
		return err(narrowed.error);
	}
	const active = narrowed.value;
	// SPEC §4.17.3: the key is read from the environment at call time,
	// never logged, cached or written.
	const keyed = resolveKey(ports.env, active.apiKeyEnv);
	if (!keyed.ok) {
		return err(keyed.error);
	}
	const started = ports.clock.now();
	let withResponseFormat = active.format === "openai-chat";
	for (let attempt = 0; ; attempt += 1) {
		const next: Advance = await runAttempt(
			ports,
			active,
			req,
			keyed.value,
			withResponseFormat,
			attempt,
			started,
		);
		if (next.kind === "return") {
			return next.result;
		}
		if (next.kind === "strip-format") {
			withResponseFormat = false;
			continue;
		}
		if (ports.sleep !== undefined) {
			await ports.sleep(next.delayMs);
		}
	}
}

// SPEC §4.17.2: the client returns Result<{ text, usage? }>; it never throws.
export function createClient(config: unknown, ports: LlmPorts): LlmClient {
	// Narrow once at construction; a shape violation fails closed on every
	// call instead of throwing from the factory.
	const narrowed = narrowLlmConfig(config);
	async function complete(
		req: CompletionRequest,
	): Promise<Result<CompletionResponse>> {
		return runComplete(narrowed, ports, req);
	}
	return { complete };
}
