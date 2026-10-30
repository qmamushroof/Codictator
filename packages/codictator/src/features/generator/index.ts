// SPEC §4.16: draft custom packs. May import llm (§3.3 hard boundary);
// enforcement paths never touch this module.
import type { PackManifest, Result } from "../../kernel/index.ts";
import type { LlmClient } from "../llm/index.ts";
import { draftWithOptions } from "./draft.ts";
import type { GeneratorFile, GeneratorInputReport } from "./prompt.ts";

export interface GeneratorInput {
	readonly id: string;
	readonly description: string;
	readonly sampleBefore: string;
	readonly sampleAfter: string;
}

export interface DraftOptions {
	readonly useLlm?: boolean;
	readonly llm?: LlmClient;
	readonly template?: string;
	readonly pattern?: string;
	readonly existingPackIds?: ReadonlyArray<string>;
	readonly floorRuleId?: string;
	readonly goodFiles?: ReadonlyArray<GeneratorFile>;
	readonly badFiles?: ReadonlyArray<GeneratorFile>;
}

export { summarizeGeneratorInputs } from "./prompt.ts";
export type { GeneratorFile, GeneratorInputReport };

// SPEC §4.16.3: draft flow from samples to a pack skeleton: draft, validate
// (with one LLM repair round), materialise deterministically, and self-test.
// The template path works fully offline; the LLM path needs options.llm.
export function draftPack(
	input: GeneratorInput,
	options: DraftOptions = {},
): Promise<Result<PackManifest>> {
	return draftWithOptions(input, options);
}
