// Split from budgets.ts by responsibility (core/file-size): usage
// producers (transcript parsing plus transcript/native resolution)
// live here; budgets.ts keeps session state and band evaluation.
import { parseJson } from "../../kernel/index.ts";

export interface TranscriptUsage {
	readonly inputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheCreationTokens: number;
}

// SPEC §4.5: context = last main-chain assistant turn's input +
// cache-read + cache-creation tokens. Subagent turns ride their own
// transcript, so isSidechain lines never count here.
export function transcriptUsedTokens(usage: TranscriptUsage): number {
	return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

function isUsageRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (kernel schema.ts pattern).
function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function usageNumber(
	record: Record<string, unknown>,
	name: string,
): number | undefined {
	const seen: unknown = record[name];
	if (typeof seen !== "number" || !Number.isFinite(seen) || seen < 0) {
		return undefined;
	}
	return seen;
}

function transcriptUsageOf(value: unknown): TranscriptUsage | undefined {
	if (!isUsageRecord(value) || field(value, "type") !== "assistant") {
		return undefined;
	}
	if (field(value, "isSidechain") === true) {
		return undefined;
	}
	const message: unknown = field(value, "message");
	if (!isUsageRecord(message)) {
		return undefined;
	}
	const usage: unknown = field(message, "usage");
	if (!isUsageRecord(usage)) {
		return undefined;
	}
	const inputTokens = usageNumber(usage, "input_tokens");
	const cacheReadTokens = usageNumber(usage, "cache_read_input_tokens");
	const cacheCreationTokens = usageNumber(usage, "cache_creation_input_tokens");
	if (
		inputTokens === undefined ||
		cacheReadTokens === undefined ||
		cacheCreationTokens === undefined
	) {
		return undefined;
	}
	return { inputTokens, cacheReadTokens, cacheCreationTokens };
}

// SPEC §4.5: the last main-chain assistant turn wins; corrupt lines and
// turns without usage are skipped, never estimated.
export function parseTranscriptUsage(
	transcriptText: string,
): TranscriptUsage | undefined {
	let found: TranscriptUsage | undefined;
	for (const line of transcriptText.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		const parsed = parseJson(line);
		if (!parsed.ok) {
			continue;
		}
		const usage = transcriptUsageOf(parsed.value);
		if (usage !== undefined) {
			found = usage;
		}
	}
	return found;
}

export type UsageDataKind = "native" | "transcript" | "none";

export interface HookUsageInput {
	readonly usageData: UsageDataKind;
	readonly nativeUsage?: {
		readonly contextTokens: number;
		readonly contextWindow?: number;
	};
	readonly transcriptText?: string;
}

export interface ResolvedHookUsage {
	readonly contextTokens: number;
	readonly contextWindow?: number;
}

export function saneWindow(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

// SPEC §4.5.2: transcript harnesses parse the transcript, native
// harnesses pass usageData through, and none yields nothing so the band
// stays unavailable instead of guessed.
export function resolveHookUsage(
	input: HookUsageInput,
): ResolvedHookUsage | undefined {
	if (input.usageData === "none") {
		return undefined;
	}
	if (input.usageData === "transcript") {
		if (input.transcriptText === undefined) {
			return undefined;
		}
		const parsed = parseTranscriptUsage(input.transcriptText);
		if (parsed === undefined) {
			return undefined;
		}
		return { contextTokens: transcriptUsedTokens(parsed) };
	}
	const native = input.nativeUsage;
	if (
		native === undefined ||
		!Number.isFinite(native.contextTokens) ||
		native.contextTokens < 0
	) {
		return undefined;
	}
	const contextWindow = saneWindow(native.contextWindow);
	return contextWindow === undefined
		? { contextTokens: native.contextTokens }
		: { contextTokens: native.contextTokens, contextWindow };
}
