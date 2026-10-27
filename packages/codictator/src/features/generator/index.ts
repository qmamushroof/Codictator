// SPEC §4.16: draft custom packs. May import llm (§3.3 hard boundary);
// enforcement paths never touch this module.
import type { Result } from "../../kernel/index.ts";
import type { PackManifest } from "../packs/index.ts";

export interface GeneratorInput {
	readonly id: string;
	readonly description: string;
	readonly sampleBefore: string;
	readonly sampleAfter: string;
}

// SPEC §4.16.3: draft flow from samples to a pack skeleton.
export function draftPack(
	_input: GeneratorInput,
): Promise<Result<PackManifest>> {
	throw new Error("not implemented: SPEC §4.16.3");
}
