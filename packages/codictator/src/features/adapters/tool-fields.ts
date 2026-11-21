// SPEC §4.5.3-§4.5.4, §4.5.8: the field readers every JSON-stdin adapter
// shares, so the Claude-shaped and OpenCode parsers never drift apart.
import { FRAGMENT_CONTENT_KEYS, WHOLE_CONTENT_KEYS } from "./contract.ts";

export type FieldRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is FieldRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// First non-empty string under any of the keys.
export function readString(
	record: FieldRecord,
	keys: ReadonlyArray<string>,
): string | undefined {
	for (const key of keys) {
		const value: unknown = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

// The first record under any of the keys; an empty record when none holds one.
export function readFirstRecord(
	raw: FieldRecord,
	keys: ReadonlyArray<string>,
): FieldRecord {
	for (const key of keys) {
		const value: unknown = raw[key];
		if (isRecord(value)) {
			return value;
		}
	}
	return {};
}

// Every non-empty path string (or string list) under the keys, sorted.
export function collectPaths(
	input: FieldRecord,
	keys: ReadonlyArray<string>,
): Array<string> {
	const found = new Set<string>();
	for (const key of keys) {
		const value: unknown = input[key];
		if (typeof value === "string" && value.length > 0) {
			found.add(value);
		} else if (Array.isArray(value)) {
			for (const entry of value) {
				if (typeof entry === "string" && entry.length > 0) {
					found.add(entry);
				}
			}
		}
	}
	return [...found].sort();
}

// The optional tool-call fields the two parsers read from a tool input. A
// whole-file content key wins over a fragment key and marks the call whole.
export function readCallFields(
	input: FieldRecord,
): Pick<
	HookToolCallFields,
	"command" | "proposedContent" | "proposedContentWhole" | "query" | "range"
> {
	const command = readString(input, ["command"]);
	const wholeContent = readString(input, WHOLE_CONTENT_KEYS);
	const proposedContent =
		wholeContent ?? readString(input, FRAGMENT_CONTENT_KEYS);
	const query = readString(input, ["query", "pattern", "prompt"]);
	const range = readRange(input);
	return {
		...(command === undefined ? {} : { command }),
		...(proposedContent === undefined ? {} : { proposedContent }),
		...(wholeContent === undefined ? {} : { proposedContentWhole: true }),
		...(query === undefined ? {} : { query }),
		...(range === undefined ? {} : { range }),
	};
}

// SPEC §7.8 tool.range: the line window of a partial read. A call that
// names only an offset reads to the end of the file.
function readRange(
	input: FieldRecord,
): { readonly offset: number; readonly limit: number } | undefined {
	const { offset, limit } = input;
	const seenOffset = typeof offset === "number" && Number.isFinite(offset);
	const seenLimit = typeof limit === "number" && Number.isFinite(limit);
	if (!seenOffset && !seenLimit) {
		return undefined;
	}
	return {
		offset: seenOffset ? offset : 0,
		limit: seenLimit ? limit : Number.MAX_SAFE_INTEGER,
	};
}

interface HookToolCallFields {
	readonly command?: string;
	readonly proposedContent?: string;
	readonly proposedContentWhole?: true;
	readonly query?: string;
	readonly range?: { readonly offset: number; readonly limit: number };
}
