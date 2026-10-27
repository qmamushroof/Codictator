// SPEC §4.9: doc checks, history, bug registry. Owns the §7.7 record
// grammars.
import type { CheckContext, Finding } from "../engine/index.ts";

export type HistoryKind = "code" | "docs" | "deps" | "guardrail";

export interface HistoryEntry {
	readonly date: string;
	readonly subject: string;
	readonly kind: HistoryKind;
	readonly task: string;
	readonly bug: string;
}

export type BugStatus = "open" | "fixed" | "wontfix";

export interface BugRow {
	readonly id: string;
	readonly status: BugStatus;
	readonly title: string;
	readonly found: string;
	readonly fix: string;
	readonly regressionTest: string;
}

// SPEC §4.9.2: doc class checks (placement, density, one fact one owner).
export function checkDocs(
	_ctx: CheckContext,
	_paths: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.9.2");
}

// SPEC §4.9.3: history entry grammar validation.
export function checkHistory(
	_ctx: CheckContext,
	_text: string,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.9.3");
}

// SPEC §4.9.4: bug registry grammar validation.
export function checkBugs(
	_ctx: CheckContext,
	_text: string,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.9.4");
}
