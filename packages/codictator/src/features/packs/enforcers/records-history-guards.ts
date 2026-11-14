// SPEC §5.8 history enforcers (decl module records-history): marker-first
// fixtures resolve here while history-checks/history-parse judge real
// scopes. Re-exported through records-guards so rule ids and import sites
// keep working unchanged.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import {
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	entryFinding,
} from "../../records/history-checks.ts";
import { parseHistoryEntries } from "../../records/history-parse.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import type { RuleBinding } from "./binding.ts";
import { isMarkerFile } from "./health-markers.ts";
import { loadScopeText } from "./health-measures.ts";
import {
	type MarkerRealArgs,
	markerKeyJudge,
	markerRealGuard,
	markerRegexJudge,
} from "./marker-scan.ts";

export function isHistoryFile(path: string): boolean {
	return path.startsWith("docs/HISTORY/");
}

export function isRecordFile(path: string): boolean {
	return path.startsWith("docs/HISTORY/") || path.startsWith("docs/BUGS/");
}

export async function historyEntryReal(
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	if (files.length === 0) {
		return [];
	}
	// SPEC §4.9.3 core/history-entry: a docs/HISTORY/ file in scope carries
	// the entry (history-append-only forbids edits, so a changed file is an
	// added entry; L3 commit-msg judges the per-commit count and subject).
	// This union-scope verdict cannot see per-commit counts across an L4
	// range; ci verify judges each commit in cli/ci-history.ts (BUG-0083).
	// A BUGS row alone exempts only a records-only change: a code change that
	// carries one (the tracked-BUGS fallback unions tracked rows into the
	// scope) still owes a HISTORY entry, so only non-record files are judged.
	if (files.some((file) => isHistoryFile(file))) {
		return [];
	}
	const judged = files.filter((file) => !isRecordFile(file));
	if (judged.length === 0) {
		return [];
	}
	return judged.map((file) =>
		entryFinding(
			"core/history-entry",
			`commit stages no history entry (checked ${file})`,
			"docs/HISTORY/",
		),
	);
}

export async function historyAppendOnlyReal(
	ports: Ports,
	binding: RuleBinding,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
): Promise<Array<Finding>> {
	const out: Array<Finding> = [];
	for (const file of files) {
		if (!isHistoryFile(file) || isMarkerFile(file)) {
			continue;
		}
		// A target with no HEAD base is new, so there is nothing earlier to
		// have edited. The base check comes first, so a not-yet-existing
		// pre-tool target never pays a fail-closed content read (§4.7.3).
		const base = await ports.git.show("HEAD", file);
		if (!base.ok) {
			continue;
		}
		const text = await loadScopeText(ports, binding, file, findings);
		if (text === undefined) {
			continue;
		}
		out.push(...checkHistoryAppendOnly(base.value, text, file));
	}
	return out;
}

export function historyEntryCompleteReal(
	texts: ReadonlyMap<string, string>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const [file, text] of texts) {
		if (!isHistoryFile(file)) {
			continue;
		}
		const entry = parseHistoryEntries(text).entries[0];
		if (entry === undefined) {
			findings.push(
				entryFinding(
					"core/history-entry-complete",
					`history file holds no entry: ${file}`,
					file,
				),
			);
			continue;
		}
		findings.push(...checkHistoryEntryComplete(entry, file));
	}
	return findings;
}

export async function realTexts(
	ports: Ports,
	binding: RuleBinding,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
): Promise<Map<string, string>> {
	const texts = new Map<string, string>();
	for (const file of files) {
		if (isMarkerFile(file)) {
			continue;
		}
		const text = await loadScopeText(ports, binding, file, findings);
		if (text !== undefined) {
			texts.set(file, text);
		}
	}
	return texts;
}

// Module-local factory: the three history resolvers share one call shape
// with distinct keys, so the resolver heads never form a cross-file run.
function historyRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	key: string,
	want: string,
	message: (file: string) => string,
	judgeReal: (args: MarkerRealArgs) => Promise<void>,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		markerKeyJudge(key, want, message),
		judgeReal,
	);
}

export function resolveHistoryEntry(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return historyRule(
		decl,
		rule,
		ports,
		"history",
		"none",
		(file) => `commit with no history entry in ${file}`,
		async (args) => {
			args.findings.push(...(await historyEntryReal(args.files)));
		},
	);
}

export function resolveHistoryAppendOnly(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		markerRegexJudge(
			/^[ \t]*edited:/m,
			(file) => `history file edited in ${file}`,
		),
		async (args) => {
			args.findings.push(
				...(await historyAppendOnlyReal(
					args.ports,
					args.binding,
					args.files,
					args.findings,
				)),
			);
		},
	);
}

export function resolveHistoryEntryComplete(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return historyRule(
		decl,
		rule,
		ports,
		"spec",
		"missing",
		(file) => `history entry missing a field in ${file}`,
		async (args) => {
			args.findings.push(
				...historyEntryCompleteReal(
					await realTexts(args.ports, args.binding, args.files, args.findings),
				),
			);
		},
	);
}
