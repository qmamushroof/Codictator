// SPEC §4.9.3: history entry checks (count, completeness, append-only).
// Pure over caller-supplied text.
import { normalizeText } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import type { HistoryEntry } from "./history-parse.ts";
import { FILE_TITLE, parseHistoryEntries } from "./history-parse.ts";

export function entryFinding(
	ruleId: string,
	message: string,
	path: string,
): Finding {
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
