// SPEC §4.16.4: what leaves the machine. Sources run in argument order;
// secret paths are excluded and listed, the rest is capped at 64 KB with a
// visible marker, and secret values in included text are redacted.
import { isSecretReadPath, redactSecrets } from "../../kernel/index.ts";
import type { DraftOptions, GeneratorInput } from "./index.ts";
import { catalogueSummary } from "./templates.ts";

export interface GeneratorFile {
	readonly path: string;
	readonly content: string;
}

export interface GeneratorInputReport {
	readonly promptBytes: number;
	readonly truncated: boolean;
	readonly cutSources: ReadonlyArray<string>;
	readonly excludedSecrets: ReadonlyArray<string>;
	readonly redacted: boolean;
}

// SPEC §11 S24: the default suggestion is never a -contributor variant.
export const DEFAULT_MODEL = "muse-spark-1.3";

const MAX_PROMPT_BYTES = 65536;
const TRUNCATION_MARKER = "…[truncated: input exceeded the §4.16.4 64 KB cap]";
const GENERATOR_PROMPT_VERSION = "codictator-generator-prompt/1";

function textBytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

interface NamedText {
	readonly source: string;
	readonly path?: string;
	readonly text: string;
}

function promptCandidates(
	input: GeneratorInput,
	options: DraftOptions,
): Array<NamedText> {
	const candidates: Array<NamedText> = [
		{ source: "description", text: input.description },
		{ source: "sampleBefore", text: input.sampleBefore },
		{ source: "sampleAfter", text: input.sampleAfter },
	];
	for (const file of options.goodFiles ?? []) {
		candidates.push({
			source: `good:${file.path}`,
			path: file.path,
			text: file.content,
		});
	}
	for (const file of options.badFiles ?? []) {
		candidates.push({
			source: `bad:${file.path}`,
			path: file.path,
			text: file.content,
		});
	}
	return candidates;
}

export interface SelectedParts {
	readonly parts: ReadonlyArray<{
		readonly source: string;
		readonly text: string;
	}>;
	readonly cut: ReadonlyArray<string>;
	readonly excluded: ReadonlyArray<string>;
	readonly bytes: number;
}

export function selectPromptParts(
	input: GeneratorInput,
	options: DraftOptions,
): SelectedParts {
	const markerBytes = textBytes(TRUNCATION_MARKER);
	const parts: Array<{ readonly source: string; readonly text: string }> = [];
	const cut: Array<string> = [];
	const excluded: Array<string> = [];
	let used = 0;
	let truncated = false;
	for (const candidate of promptCandidates(input, options)) {
		if (candidate.path !== undefined && isSecretReadPath(candidate.path)) {
			excluded.push(candidate.path);
			continue;
		}
		if (truncated) {
			cut.push(candidate.source);
			continue;
		}
		if (used + textBytes(candidate.text) <= MAX_PROMPT_BYTES) {
			parts.push({ source: candidate.source, text: candidate.text });
			used += textBytes(candidate.text);
			continue;
		}
		const room = MAX_PROMPT_BYTES - used;
		let keep = candidate.text.slice(0, Math.max(0, room - markerBytes));
		while (keep.length > 0 && textBytes(keep) + markerBytes > room) {
			keep = keep.slice(0, Math.floor(keep.length / 2));
		}
		parts.push({
			source: candidate.source,
			text: `${keep}${TRUNCATION_MARKER}`,
		});
		used = MAX_PROMPT_BYTES;
		cut.push(candidate.source);
		truncated = true;
	}
	return { parts, cut, excluded, bytes: used };
}

// The prompt report the CLI prints with the self-test report (§4.16.3 step
// 4): what was cut, which secret paths were excluded, and whether secret
// values in included text were redacted.
export function summarizeGeneratorInputs(
	input: GeneratorInput,
	options: DraftOptions = {},
): GeneratorInputReport {
	const selected = selectPromptParts(input, options);
	let redacted = false;
	for (const part of selected.parts) {
		if (redactSecrets(part.text) !== part.text) {
			redacted = true;
			break;
		}
	}
	return {
		promptBytes: selected.bytes,
		truncated: selected.cut.length > 0,
		cutSources: selected.cut,
		excludedSecrets: selected.excluded,
		redacted,
	};
}

export function buildPrompt(
	input: GeneratorInput,
	selected: SelectedParts,
): string {
	const lines: Array<string> = [
		`${GENERATOR_PROMPT_VERSION} (SPEC §4.16.3; default model ${DEFAULT_MODEL})`,
		"Return only a JSON draft matching schema/pack-draft.schema.json.",
		`Templates (id -> enforcer kind): ${catalogueSummary()}.`,
		"Rules must reference template ids and parameters only; no executable code (§11 S23).",
		`Requirement: ${redactSecrets(input.description)}`,
	];
	for (const part of selected.parts) {
		lines.push(`--- ${part.source} ---`);
		lines.push(redactSecrets(part.text));
	}
	return `${lines.join("\n")}\n`;
}
