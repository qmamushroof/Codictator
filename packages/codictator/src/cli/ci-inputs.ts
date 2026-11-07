// Split from ci.ts by responsibility (core/file-size): this module owns
// the verify evaluation inputs, so one repo-config read serves the hash,
// the trailer exemptions and the pack entries together.
import { trailerExemptFrom } from "./ci-range.ts";
import { loadRepoConfig } from "./shared.ts";

export interface VerifyInputs {
	readonly configHash: string;
	readonly trailerExempt: ReadonlyArray<string>;
	readonly packEntries: ReadonlyArray<{
		readonly id: string;
		readonly version?: string;
	}>;
}

// The verify evaluation inputs (the stored config hash plus the trailer
// exemption list) load together: one repo-config read serves all three,
// and the handleCi dispatch stays under the complexity gate.
export async function verifyInputs(
	root: string,
	engineVersion: string,
): Promise<VerifyInputs> {
	let configHash = "unknown";
	let trailerExempt: ReadonlyArray<string> = [];
	let packEntries: ReadonlyArray<{
		readonly id: string;
		readonly version?: string;
	}> = [];
	const configured = await loadRepoConfig(root, undefined, engineVersion);
	if (configured.ok) {
		configHash = configured.value.effective.configHash;
		trailerExempt = trailerExemptFrom(configured.value.effective.config);
		packEntries = configured.value.effective.config.packs;
	}
	return { configHash, trailerExempt, packEntries };
}
