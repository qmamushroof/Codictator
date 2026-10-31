// SPEC §4.17.1: the preset table and the §7.2 llm config block narrowing.
// S24: the meta preset (model muse-spark-1.3) is the default suggestion and
// no preset selects a -contributor variant.
import { err, makeError, ok, type Result } from "../../kernel/index.ts";

export type LlmFormat = "openai-chat" | "anthropic-messages";

export type LlmPresetId =
	| "meta"
	| "meta-messages"
	| "openai-compatible"
	| "anthropic"
	| "openai";

export interface LlmPreset {
	readonly baseUrl: string;
	readonly format: LlmFormat;
	readonly model: string;
	readonly apiKeyEnv?: string;
}

function preset(
	baseUrl: string,
	format: LlmFormat,
	model: string,
	apiKeyEnv?: string,
): LlmPreset {
	return apiKeyEnv === undefined
		? { baseUrl, format, model }
		: { baseUrl, format, model, apiKeyEnv };
}

// SPEC §4.17.1: the preset table. openai-compatible targets a local runtime
// (127.0.0.1 over http is allowed for it); every other preset needs https.
export const LLM_PRESETS: Record<LlmPresetId, LlmPreset> = {
	meta: preset(
		"https://api.meta.ai/v1",
		"openai-chat",
		"muse-spark-1.3",
		"MODEL_API_KEY",
	),
	"meta-messages": preset(
		"https://api.meta.ai/v1",
		"anthropic-messages",
		"muse-spark-1.3",
		"MODEL_API_KEY",
	),
	"openai-compatible": preset("", "openai-chat", ""),
	anthropic: preset(
		"https://api.anthropic.com/v1",
		"anthropic-messages",
		"",
		"ANTHROPIC_API_KEY",
	),
	openai: preset(
		"https://api.openai.com/v1",
		"openai-chat",
		"",
		"OPENAI_API_KEY",
	),
};

export const DEFAULT_PRESET_ID: LlmPresetId = "meta";

export const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

const PRESET_IDS: ReadonlyArray<string> = [
	"meta",
	"meta-messages",
	"openai-compatible",
	"anthropic",
	"openai",
];

export interface LlmConfig {
	readonly provider: LlmPresetId;
	readonly baseUrl: string;
	readonly format: LlmFormat;
	readonly model: string;
	readonly apiKeyEnv?: string;
	readonly timeoutMs: number;
	readonly maxOutputTokens: number;
	readonly reasoningEffort?: string;
}

function configError<T>(message: string): Result<T> {
	return err(
		makeError(
			"CDX-E106",
			message,
			"Set config.llm to a preset from SPEC §4.17.1 (provider, baseUrl, format, model, apiKeyEnv) with an https baseUrl, or point it at a 127.0.0.1 runtime.",
		),
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (deps/fields narrows the same
// way over its own records; this module stays dependency-free).
function configField(config: Record<string, unknown>, name: string): unknown {
	return config[name];
}

// One defaulting helper so the narrow functions below spend their branch
// budget on validation, not on fallback plumbing.
function fieldOr(
	config: Record<string, unknown>,
	name: string,
	fallback: unknown,
): unknown {
	const value = config[name];
	return value ?? fallback;
}

function isPresetId(value: unknown): value is LlmPresetId {
	return typeof value === "string" && PRESET_IDS.includes(value);
}

function isFormat(value: unknown): value is LlmFormat {
	return value === "openai-chat" || value === "anthropic-messages";
}

// SPEC §4.17.1: apiKeyEnv names an environment variable; a literal key is
// rejected with CDX-E106 instead of being sent anywhere.
function isEnvName(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isLoopbackHost(host: string): boolean {
	const lowered = host.toLowerCase();
	return (
		lowered === "localhost" ||
		lowered === "::1" ||
		lowered === "127.0.0.1" ||
		lowered.startsWith("127.")
	);
}

// SPEC §4.17.4 EC-5: http is refused on non-loopback hosts (keys over
// plaintext); a loopback host stays allowed for local runtimes.
function checkBaseUrl(raw: string): Result<string> {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return configError(`llm baseUrl is not an absolute url: ${raw}`);
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return configError(`llm baseUrl must be https or loopback http: ${raw}`);
	}
	if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
		return configError(
			`llm baseUrl uses plaintext http on a non-loopback host: ${raw}`,
		);
	}
	return ok(raw);
}

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
		? value
		: undefined;
}

// Narrow the §7.2 llm block: explicit fields override the named preset and
// every shape violation fails closed with CDX-E106. Split so no function
// trips the complexity or size guards.
interface LlmEndpoint {
	readonly provider: LlmPresetId;
	readonly baseUrl: string;
	readonly format: LlmFormat;
	readonly model: string;
}

function narrowEndpoint(config: Record<string, unknown>): Result<LlmEndpoint> {
	const providerRaw = fieldOr(config, "provider", DEFAULT_PRESET_ID);
	if (!isPresetId(providerRaw)) {
		return configError(
			`unknown llm provider: ${String(fieldOr(config, "provider", ""))}`,
		);
	}
	const defaults = LLM_PRESETS[providerRaw];
	const baseUrlRaw = fieldOr(config, "baseUrl", defaults.baseUrl);
	if (typeof baseUrlRaw !== "string" || baseUrlRaw === "") {
		return configError(`llm provider ${providerRaw} needs a baseUrl`);
	}
	const checked = checkBaseUrl(baseUrlRaw);
	if (!checked.ok) {
		return err(checked.error);
	}
	const formatRaw = fieldOr(config, "format", defaults.format);
	if (!isFormat(formatRaw)) {
		return configError(`unknown llm format: ${String(formatRaw)}`);
	}
	const modelRaw = fieldOr(config, "model", defaults.model);
	if (typeof modelRaw !== "string" || modelRaw === "") {
		return configError(`llm provider ${providerRaw} needs a model`);
	}
	return ok({
		provider: providerRaw,
		baseUrl: baseUrlRaw,
		format: formatRaw,
		model: modelRaw,
	});
}

function narrowBudgets(
	config: Record<string, unknown>,
	endpoint: LlmEndpoint,
): Result<LlmConfig> {
	const fallbackKey = LLM_PRESETS[endpoint.provider].apiKeyEnv;
	const apiKeyEnvRaw = fieldOr(config, "apiKeyEnv", fallbackKey);
	if (apiKeyEnvRaw !== undefined && !isEnvName(apiKeyEnvRaw)) {
		return configError("llm apiKeyEnv must name an environment variable");
	}
	const timeoutRaw = fieldOr(config, "timeoutMs", DEFAULT_TIMEOUT_MS);
	const timeoutMs = positiveInt(timeoutRaw);
	if (timeoutMs === undefined) {
		return configError("llm timeoutMs must be a positive integer");
	}
	const tokensRaw = fieldOr(
		config,
		"maxOutputTokens",
		DEFAULT_MAX_OUTPUT_TOKENS,
	);
	const maxOutputTokens = positiveInt(tokensRaw);
	if (maxOutputTokens === undefined) {
		return configError("llm maxOutputTokens must be a positive integer");
	}
	const reasoningRaw = configField(config, "reasoningEffort");
	if (reasoningRaw !== undefined && typeof reasoningRaw !== "string") {
		return configError("llm reasoningEffort must be a string");
	}
	const narrowed: LlmConfig = {
		provider: endpoint.provider,
		baseUrl: endpoint.baseUrl,
		format: endpoint.format,
		model: endpoint.model,
		timeoutMs,
		maxOutputTokens,
		...(apiKeyEnvRaw === undefined ? {} : { apiKeyEnv: apiKeyEnvRaw }),
	};
	return reasoningRaw === undefined
		? ok(narrowed)
		: ok({ ...narrowed, reasoningEffort: reasoningRaw });
}

export function narrowLlmConfig(config: unknown): Result<LlmConfig> {
	if (!isRecord(config)) {
		return configError("llm config must be an object");
	}
	const endpoint = narrowEndpoint(config);
	if (!endpoint.ok) {
		return err(endpoint.error);
	}
	return narrowBudgets(config, endpoint.value);
}
