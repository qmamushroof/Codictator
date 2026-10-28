// SPEC §4.6.3: the scoped injection returned on session.start,
// compact.post and prompt.submit. Built from committed state, never from a
// compaction summary; at most 2,000 bytes. The runtime re-sends it only
// when its digest differs from the last injection in the session, so the
// digest helper lives beside the renderer.
import { sha256Text } from "../../kernel/index.ts";
import { isSubagentSession } from "./budgets.ts";
import {
	PRECEDENCE_STATEMENT,
	SCOPED_INJECTION_MAX_BYTES,
	utf8Bytes,
} from "./precedence.ts";

export interface InjectionRuleLine {
	readonly id: string;
	readonly statement: string;
	readonly floor: boolean;
}

export interface InjectionOptions {
	readonly checkpointRequired?: boolean;
	readonly isSubagent?: boolean;
	readonly taskSummary?: string;
	readonly allowedFiles?: ReadonlyArray<string>;
	readonly testSummary?: string;
	readonly reviewFindings?: string;
	readonly relevantRules?: ReadonlyArray<InjectionRuleLine>;
	readonly usedTokens?: number;
	readonly contextWindow?: number;
	readonly checkpointCommand?: string;
}

// The runtime compares digests to honour "re-sent only when its hash
// differs", so an unchanged state costs nothing (SPEC §4.6.3).
export function injectionDigest(content: string): string {
	return sha256Text(content);
}

function ruleText(rule: InjectionRuleLine): string {
	return `${rule.id} — ${rule.statement}`;
}

// Relevant rules for raw scopes with no rule resolution: one line per
// scope, floor-first when the caller labels them.
function rulesForScopes(
	scopes: ReadonlyArray<string>,
): Array<InjectionRuleLine> {
	return [...scopes].sort().map((scope) => ({
		id: scope,
		statement: "scoped context",
		floor: false,
	}));
}

function budgetLine(options: InjectionOptions): string {
	if (
		options.usedTokens !== undefined &&
		options.contextWindow !== undefined &&
		options.contextWindow > 0
	) {
		return `Budget: ${options.usedTokens}/${options.contextWindow} tokens used.`;
	}
	return "Budget: unavailable (no usage data).";
}

// SPEC §4.6.7 EC-12: the rules list truncates floor-first with the
// codictator context pointer naming the elided count. Fixed head and tail
// lines always survive; only rule lines are dropped.
function moreLine(omitted: number): string {
	return `and ${omitted} more: codictator context --all`;
}

function fittedMiddle(
	kept: ReadonlyArray<string>,
	total: number,
): Array<string> {
	const omitted = total - kept.length;
	return omitted > 0 ? [...kept, moreLine(omitted)] : [...kept];
}

// SPEC §4.6.7 EC-12: the rules list truncates floor-first with the
// codictator context pointer naming the elided count. Fixed head and tail
// lines always survive; only rule lines are dropped.
function fitInjection(
	head: ReadonlyArray<string>,
	ruleLines: ReadonlyArray<string>,
	tail: ReadonlyArray<string>,
	maxBytes: number,
): string {
	const kept: Array<string> = [...ruleLines];
	let middle = fittedMiddle(kept, ruleLines.length);
	while (
		utf8Bytes([...head, ...middle, ...tail].join("\n")) > maxBytes &&
		kept.length > 0
	) {
		kept.pop();
		middle = fittedMiddle(kept, ruleLines.length);
	}
	let content = [...head, ...middle, ...tail].join("\n");
	if (utf8Bytes(content) > maxBytes) {
		const bytes = new TextEncoder().encode(content).slice(0, maxBytes);
		content = new TextDecoder().decode(bytes);
	}
	return content;
}

function checkpointLines(command: string): Array<string> {
	return [
		"Checkpoint required: every tool call is blocked except codictator task",
		`checkpoint, git add/commit of the task record, and task record reads (${command}).`,
		"Run /clear or /new (or start a new session); the resume note is in",
		".codictator/state/resume.md.",
	];
}

function subagentLines(): Array<string> {
	return [
		"Subagent hard band: do not clear. Return CHECKPOINT: <one-line summary>",
		"to your caller instead; the parent session is unaffected.",
	];
}

export function renderScopedInjection(
	sessionId: string,
	scope: ReadonlyArray<string>,
	maxBytes: number,
	options: InjectionOptions = {},
): Promise<{
	readonly sessionId: string;
	readonly content: string;
	readonly bytes: number;
}> {
	const limit = Math.min(maxBytes, SCOPED_INJECTION_MAX_BYTES);
	const subagent = options.isSubagent ?? isSubagentSession(sessionId);
	const tail: Array<string> = [budgetLine(options)];
	if (options.checkpointRequired === true) {
		tail.push(...checkpointLines(options.checkpointCommand ?? "codictator"));
	}
	if (subagent) {
		tail.push(...subagentLines());
	}
	let head: Array<string>;
	let ruleLines: Array<string>;
	if (scope.length === 0 && options.taskSummary === undefined) {
		head = [
			PRECEDENCE_STATEMENT,
			"",
			"No active task. Start one: codictator task new, then work only inside",
			"the plan it records (core/workflow-gates).",
			"",
		];
		ruleLines = [];
	} else {
		const rules = options.relevantRules ?? rulesForScopes(scope);
		const ordered = [...rules].sort((a, b) => {
			if (a.floor !== b.floor) {
				return a.floor ? -1 : 1;
			}
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
		head = [
			`Task: ${options.taskSummary ?? "unassigned — codictator task new"}`,
			`Allowed files: ${(options.allowedFiles ?? scope).join(", ") || "(none)"}`,
			`Tests: ${options.testSummary ?? "(none recorded)"}`,
			`Open review findings: ${options.reviewFindings ?? "(none)"}`,
			"Relevant rules:",
		];
		ruleLines = ordered.map(ruleText);
	}
	const content = fitInjection(head, ruleLines, tail, limit);
	return Promise.resolve({
		sessionId,
		content,
		bytes: utf8Bytes(content),
	});
}
