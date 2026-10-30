// SPEC §4.9.3 and §7.7: change-history entries, the append-only check and
// kind derivation. Pure over caller-supplied text: the base revision comes
// from the Git port at the enforcer layer, never from here.
import { normalizeText } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";

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
const FILE_TITLE = /^# History — \d{4}-\d{2}-\d{2}(-\d+)?\s*$/;

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
export function parseHistoryEntries(text: string): HistoryParse {
	const entries: Array<HistoryEntry> = [];
	const errors: Array<string> = [];
	let current: HistoryEntry | undefined;
	let fields = new Map<string, string>();
	let depsLines: Array<string> = [];
	const flush = (): void => {
		if (current !== undefined) {
			entries.push({
				...current,
				kind: toKind(fields.get("Kind")),
				task: fields.get("Task"),
				bug: fields.get("Bug"),
				fields: new Map(fields),
				depsLines: [...depsLines],
			});
		}
		current = undefined;
		fields = new Map();
		depsLines = [];
	};
	for (const raw of normalizeText(text).split("\n")) {
		const heading = ENTRY_HEADING.exec(raw);
		if (heading !== null) {
			flush();
			current = emptyEntry(heading[1] ?? "", heading[2] ?? "");
			continue;
		}
		if (current === undefined) {
			if (raw.trim() !== "" && FILE_TITLE.exec(raw.trim()) === null) {
				errors.push(`history text outside any entry: "${raw.trim()}"`);
			}
			continue;
		}
		if (raw.trim() === "") {
			continue;
		}
		const field = FIELD_LINE.exec(raw);
		if (field === null) {
			errors.push(`history line outside the field grammar: "${raw.trim()}"`);
			continue;
		}
		const name = field[1] ?? "";
		const value = field[2] ?? "";
		if (name === "Deps") {
			depsLines.push(value);
		} else if (fields.has(name)) {
			errors.push(`history field repeated in one entry: ${name}`);
		} else {
			fields.set(name, value);
		}
	}
	flush();
	return { entries, errors };
}

function entryFinding(ruleId: string, message: string, path: string): Finding {
	return {
		ruleId,
		path,
		message,
		remediation: `Add exactly one history entry whose Subject equals the commit subject, with the Kind, Task, Why and kind-required fields of SPEC §7.7, to ${path}.`,
	};
}

// SPEC §4.9.3 core/history-entry: the staged diff adds exactly one entry
// whose Subject equals the message subject.
export function checkHistoryEntryCount(
	text: string,
	path: string,
	commitSubject?: string,
): Array<Finding> {
	const parsed = parseHistoryEntries(text);
	const problems = [...parsed.errors];
	if (parsed.entries.length !== 1) {
		return [
			entryFinding(
				"core/history-entry",
				`history change holds ${parsed.entries.length} entries, want exactly one: ${path}`,
				path,
			),
		];
	}
	if (
		commitSubject !== undefined &&
		parsed.entries[0]?.subject !== commitSubject
	) {
		return [
			entryFinding(
				"core/history-entry",
				`history Subject "${parsed.entries[0]?.subject ?? ""}" differs from the commit subject "${commitSubject}"`,
				path,
			),
		];
	}
	return problems.map((message) =>
		entryFinding("core/history-entry", message, path),
	);
}

// SPEC §4.9.3 core/history-entry-complete: the kind-required fields are
// present and non-empty. Bug is required by the registry check, which knows
// the commit type; completeness covers the kind shape only.
export function checkHistoryEntryComplete(
	entry: HistoryEntry,
	path: string,
): Array<Finding> {
	const required: Array<string> =
		entry.kind === "code"
			? ["Kind", "Task", "Why", "What went wrong", "Trade-offs", "Lessons"]
			: entry.kind === "docs"
				? ["Kind", "Task", "Why", "Docs"]
				: entry.kind === "deps"
					? ["Kind", "Task", "Why"]
					: entry.kind === "guardrail"
						? ["Kind", "Task", "Why"]
						: ["Kind", "Task", "Why"];
	const findings: Array<Finding> = [];
	for (const name of required) {
		const value = entry.fields.get(name);
		if (value === undefined || value.trim() === "") {
			findings.push({
				ruleId: "core/history-entry-complete",
				path,
				message: `history entry misses its ${name} field: ${entry.subject}`,
				remediation: `Fill the ${name} field of the "${entry.subject}" entry in ${path}; a field not required is omitted, a required one is never empty.`,
			});
		}
	}
	if (entry.kind === "deps" && entry.depsLines.length === 0) {
		findings.push({
			ruleId: "core/history-entry-complete",
			path,
			message: `deps history entry holds no Deps line: ${entry.subject}`,
			remediation: `Add one Deps line per dependency change to the "${entry.subject}" entry in ${path}.`,
		});
	}
	return findings;
}

// SPEC §4.9.3 core/history-append-only: the base content after the title
// line is a suffix of the head content after normalisation, so new entries
// are prepended directly under the title and existing entries are never
// edited.
function bodyAfterTitle(text: string): string | undefined {
	const end = text.indexOf("\n");
	if (end < 0) {
		return undefined;
	}
	if (FILE_TITLE.exec(text.slice(0, end).trim()) === null) {
		return undefined;
	}
	return text.slice(end + 1);
}

export function checkHistoryAppendOnly(
	baseText: string,
	headText: string,
	path: string,
): Array<Finding> {
	const baseBody = bodyAfterTitle(normalizeText(baseText));
	const headBody = bodyAfterTitle(normalizeText(headText));
	if (baseBody !== undefined && headBody?.endsWith(baseBody) === true) {
		return [];
	}
	return [
		{
			ruleId: "core/history-append-only",
			path,
			message: `history file edited in place: ${path} head no longer holds its base entries untouched under the title`,
			remediation: `Prepend the new entry directly under the title of ${path} without touching earlier entries; history is newest-first.`,
		},
	];
}

const TOOLCHAIN_FILES: ReadonlySet<string> = new Set([
	"package.json",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	".nvmrc",
	".node-version",
	".editorconfig",
	".gitattributes",
	".gitignore",
]);

function isMetadata(path: string): boolean {
	const base = path.split("/").pop() ?? path;
	return (
		base.startsWith("LICENSE") ||
		base.startsWith("NOTICE") ||
		TOOLCHAIN_FILES.has(base)
	);
}

function isDocPath(path: string): boolean {
	return path.endsWith(".md") || isMetadata(path);
}

// SPEC §4.9.3: the kind follows the commit's paths after dropping record
// files. manifestPaths names the guardrail-manifest entries (§4.14.1); lock
// and toolchain files are the §4.8.1 set.
export function deriveHistoryKind(
	changedPaths: ReadonlyArray<string>,
	manifestPaths: ReadonlySet<string> = new Set(),
): HistoryKind {
	const remaining = changedPaths.filter(
		(path) =>
			!path.startsWith("docs/HISTORY/") && !path.startsWith("docs/BUGS/"),
	);
	if (remaining.length === 0) {
		return "docs";
	}
	const kinds = new Set<HistoryKind>();
	for (const path of remaining) {
		if (manifestPaths.has(path)) {
			kinds.add("guardrail");
		} else if (
			path.endsWith(".lock") ||
			TOOLCHAIN_FILES.has(path.split("/").pop() ?? path)
		) {
			kinds.add("deps");
		} else if (isDocPath(path)) {
			kinds.add("docs");
		} else {
			kinds.add("code");
		}
	}
	if (kinds.size === 1) {
		const only = [...kinds][0];
		return only ?? "code";
	}
	return "code";
}

function historyFileOf(files: ReadonlyArray<string>): string | undefined {
	return [...files]
		.filter((file) => file.startsWith("docs/HISTORY/"))
		.sort()[0];
}

// The evaluation-path entry: the staged files come from the check context;
// count, subject, completeness and, when the base text is supplied,
// append-only.
export function checkHistory(
	ctx: CheckContext,
	text: string,
	baseText?: string,
	commitSubject?: string,
): Promise<Array<Finding>> {
	return Promise.resolve(
		checkHistoryFiles(ctx.scope.files, text, baseText, commitSubject),
	);
}

export function checkHistoryFiles(
	files: ReadonlyArray<string>,
	text: string,
	baseText?: string,
	commitSubject?: string,
): Array<Finding> {
	const historyPath = historyFileOf(files);
	if (historyPath === undefined) {
		return [
			entryFinding(
				"core/history-entry",
				"commit stages no history entry",
				"docs/HISTORY/",
			),
		];
	}
	const findings = checkHistoryEntryCount(text, historyPath, commitSubject);
	if (findings.length > 0) {
		return findings;
	}
	const parsed = parseHistoryEntries(text);
	const entry = parsed.entries[0];
	if (entry === undefined) {
		return findings;
	}
	findings.push(...checkHistoryEntryComplete(entry, historyPath));
	if (baseText !== undefined) {
		findings.push(...checkHistoryAppendOnly(baseText, text, historyPath));
	}
	return findings;
}
