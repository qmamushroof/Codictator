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
	"command" | "proposedContent" | "proposedContentWhole" | "query"
> {
	const command = readString(input, ["command"]);
	const wholeContent = readString(input, WHOLE_CONTENT_KEYS);
	const proposedContent =
		wholeContent ?? readString(input, FRAGMENT_CONTENT_KEYS);
	const query = readString(input, ["query", "pattern", "prompt"]);
	return {
		...(command === undefined ? {} : { command }),
		...(proposedContent === undefined ? {} : { proposedContent }),
		...(wholeContent === undefined ? {} : { proposedContentWhole: true }),
		...(query === undefined ? {} : { query }),
	};
}

interface HookToolCallFields {
	readonly command?: string;
	readonly proposedContent?: string;
	readonly proposedContentWhole?: true;
	readonly query?: string;
}
