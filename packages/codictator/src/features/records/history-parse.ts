// SPEC §7.7: history entry grammar and parser. Pure over caller-supplied
// text: the base revision comes from the Git port at the enforcer layer,
// never from here.
import { normalizeText } from "../../kernel/index.ts";

export type HistoryKind = "code" | "docs" | "deps" | "guardrail";

export interface HistoryEntry {
	readonly date: string;
	readonly subject: string;
	readonly kind: HistoryKind | undefined;
	readonly task: string | undefined;
	readonly bug: string | undefined;
	readonly fields: ReadonlyMap<string, string>;
	readonly depsLines: ReadonlyArray<string>;
}

export interface HistoryParse {
	readonly entries: ReadonlyArray<HistoryEntry>;
	readonly errors: ReadonlyArray<string>;
}

const ENTRY_HEADING = /^## (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/;
const FIELD_LINE = /^- \*\*([A-Za-z -]+):\*\* (.*)$/;
export const FILE_TITLE = /^# History — \d{4}-\d{2}-\d{2}(-\d+)?\s*$/;

function emptyEntry(date: string, subject: string): HistoryEntry {
	return {
		date,
		subject,
		kind: undefined,
		task: undefined,
		bug: undefined,
		fields: new Map(),
		depsLines: [],
	};
}

function toKind(value: string | undefined): HistoryKind | undefined {
	if (
		value === "code" ||
		value === "docs" ||
		value === "deps" ||
		value === "guardrail"
	) {
		return value;
	}
	return undefined;
}

// SPEC §7.7: a history file holds one entry per commit, newest directly
// under the title, then in reverse-chronological commit order, each
// a heading plus its field list in the fixed order.
interface ParseState {
	current: HistoryEntry | undefined;
	fields: Map<string, string>;
	depsLines: Array<string>;
	entries: Array<HistoryEntry>;
	errors: Array<string>;
}

function newParseState(): ParseState {
	return {
		current: undefined,
		fields: new Map(),
		depsLines: [],
		entries: [],
		errors: [],
	};
}

function flushEntry(state: ParseState): void {
	if (state.current !== undefined) {
		state.entries.push({
			...state.current,
			kind: toKind(state.fields.get("Kind")),
			task: state.fields.get("Task"),
			bug: state.fields.get("Bug"),
			fields: new Map(state.fields),
			depsLines: [...state.depsLines],
		});
	}
	state.current = undefined;
	state.fields = new Map();
	state.depsLines = [];
}

function applyHeading(state: ParseState, raw: string): boolean {
	const heading = ENTRY_HEADING.exec(raw);
	if (heading === null) {
		return false;
	}
	flushEntry(state);
	state.current = emptyEntry(heading[1] ?? "", heading[2] ?? "");
	return true;
}

function applyOutsideEntry(state: ParseState, raw: string): void {
	if (raw.trim() !== "" && FILE_TITLE.exec(raw.trim()) === null) {
		state.errors.push(`history text outside any entry: "${raw.trim()}"`);
	}
}

function applyFieldLine(state: ParseState, raw: string): void {
	const field = FIELD_LINE.exec(raw);
	if (field === null) {
		state.errors.push(
			`history line outside the field grammar: "${raw.trim()}"`,
		);
		return;
	}
	const name = field[1] ?? "";
	const value = field[2] ?? "";
	if (name === "Deps") {
		state.depsLines.push(value);
		return;
	}
	if (state.fields.has(name)) {
		state.errors.push(`history field repeated in one entry: ${name}`);
		return;
	}
	state.fields.set(name, value);
}

export function parseHistoryEntries(text: string): HistoryParse {
	const state = newParseState();
	for (const raw of normalizeText(text).split("\n")) {
		if (applyHeading(state, raw)) {
			continue;
		}
		if (state.current === undefined) {
			applyOutsideEntry(state, raw);
			continue;
		}
		if (raw.trim() === "") {
			continue;
		}
		applyFieldLine(state, raw);
	}
	flushEntry(state);
	return { entries: state.entries, errors: state.errors };
}
