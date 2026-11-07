// SPEC §4.9.3: history kind derivation and the evaluation-path entry.
// The staged files come from the check context; count, subject,
// completeness and, when the base text is supplied, append-only.
import type { CheckContext, Finding } from "../engine/index.ts";
import {
	addedHistoryEntries,
	checkAddedHistoryEntryCount,
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	entryFinding,
} from "./history-checks.ts";
import type { HistoryKind } from "./history-parse.ts";

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
	// SPEC §4.9.3: the staged diff adds exactly one entry. Accumulated
	// history files hold many entries, so the verdict judges ADDED subjects
	// (staged minus HEAD) and runs completeness on the added entry; the
	// whole-file count helper stays for the single-entry evaluation path.
	const findings = checkAddedHistoryEntryCount(
		text,
		baseText,
		historyPath,
		commitSubject,
	);
	if (findings.length > 0) {
		return findings;
	}
	const entry = addedHistoryEntries(text, baseText)[0];
	if (entry === undefined) {
		return findings;
	}
	findings.push(...checkHistoryEntryComplete(entry, historyPath));
	if (baseText !== undefined) {
		findings.push(...checkHistoryAppendOnly(baseText, text, historyPath));
	}
	return findings;
}
