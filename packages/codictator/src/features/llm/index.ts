// SPEC §4.17: provider-agnostic completion client. Only generator and cli
// may import this module (§3.3 hard boundary); no enforcement path does.
import type { Result } from "../../kernel/index.ts";

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

// SPEC §4.17.2: client construction from the §7.2 llm config block.
export function createClient(_config: unknown): LlmClient {
	throw new Error("not implemented: SPEC §4.17.2");
}
