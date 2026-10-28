// SPEC §4.4.5 batch attribution: parsed tool output becomes pack-rule
// findings, escapes become one CDX-E207, and every batch outcome maps to
// the fail-closed code the section owns (E207/E208/E209/E902).
import { err, ok, type Result } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import { findingFor, type RuleBinding } from "./binding.ts";
import type { ExternalArgs, ToolDecl, ToolEvent } from "./external.ts";
import {
	type ParsedToolOutput,
	parseJsonOutput,
	parseRegexOutput,
} from "./external-output.ts";
import { type BatchOutcome, digestArgv } from "./external-runs.ts";
import { parseSarif } from "./external-sarif.ts";

export interface ResolvedExternal {
	readonly tool: ToolDecl;
	readonly args: ExternalArgs;
	readonly specificRules: ReadonlyArray<string>;
	readonly wildcard: boolean;
	readonly timeoutMs: number;
	readonly onToolEvent: ((event: ToolEvent) => void) | undefined;
}

export function detailVars(toolId: string): Record<string, string> {
	return { detail: toolId };
}

export function closedFinding(
	binding: RuleBinding,
	toolId: string,
	code: string,
	detail: string,
): Finding {
	return findingFor(binding, {
		code,
		message: `external tool "${toolId}" ${detail}`,
		vars: detailVars(toolId),
	});
}

function parseBatchOutput(
	resolved: ResolvedExternal,
	text: string,
): Result<ParsedToolOutput> {
	const output = resolved.args.output;
	if (output.format === "sarif") {
		return parseSarif(text);
	}
	if (output.format === "json") {
		if (output.select === undefined) {
			return err({
				code: "CDX-E207",
				message: "json output needs a select binding",
				remediation: "Fix the pack output binding, then reload.",
			});
		}
		return parseJsonOutput(text, output.select);
	}
	if (output.format === "regex") {
		if (output.pattern === undefined) {
			return err({
				code: "CDX-E207",
				message: "regex output needs a pattern binding",
				remediation: "Fix the pack output binding, then reload.",
			});
		}
		return parseRegexOutput(text, output.pattern);
	}
	return ok({ findings: [], escapes: 0 });
}

function attributeFindings(
	binding: RuleBinding,
	resolved: ResolvedExternal,
	parsed: ParsedToolOutput,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const entry of parsed.findings) {
		const kept =
			resolved.specificRules.includes(entry.toolRule) || resolved.wildcard;
		if (!kept) {
			continue;
		}
		const withPath = entry.path === undefined ? {} : { path: entry.path };
		const withLine = entry.line === undefined ? {} : { line: entry.line };
		findings.push(
			findingFor(binding, {
				message: entry.message,
				vars: {
					path: entry.path ?? "",
					line: entry.line === undefined ? "" : String(entry.line),
				},
				...withPath,
				...withLine,
			}),
		);
	}
	if (parsed.escapes > 0) {
		findings.push(
			closedFinding(
				binding,
				resolved.tool.id,
				"CDX-E207",
				`named ${String(parsed.escapes)} paths outside the repo; they were dropped`,
			),
		);
	}
	return findings;
}

export function runBatch(
	binding: RuleBinding,
	resolved: ResolvedExternal,
	version: string,
	argv: ReadonlyArray<string>,
	outcome: BatchOutcome,
): { readonly findings: Array<Finding>; readonly event: ToolEvent } {
	const toolId = resolved.tool.id;
	const event = (exitCode: number, findingCount: number): ToolEvent => ({
		toolId,
		version,
		argvDigest: digestArgv(argv),
		exitCode,
		findingCount,
	});
	if (!outcome.ok) {
		const found = [
			closedFinding(binding, toolId, outcome.error.code, "failed"),
		];
		return { findings: found, event: event(-1, found.length) };
	}
	if (outcome.timedOut) {
		const found = [closedFinding(binding, toolId, "CDX-E902", "timed out")];
		return { findings: found, event: event(outcome.code, found.length) };
	}
	if (outcome.truncated) {
		const found = [
			closedFinding(
				binding,
				toolId,
				"CDX-E207",
				"output exceeded the size cap",
			),
		];
		return { findings: found, event: event(outcome.code, found.length) };
	}
	if (resolved.args.passCodes.includes(outcome.code)) {
		return { findings: [], event: event(outcome.code, 0) };
	}
	if (!resolved.args.findingCodes.includes(outcome.code)) {
		const found = [
			closedFinding(
				binding,
				toolId,
				"CDX-E207",
				`exited with unlisted code ${String(outcome.code)}`,
			),
		];
		return { findings: found, event: event(outcome.code, found.length) };
	}
	if (resolved.args.output.format === "exit-code") {
		const found = [
			findingFor(binding, {
				message: `external tool "${toolId}" reported findings`,
				vars: detailVars(toolId),
			}),
		];
		return { findings: found, event: event(outcome.code, found.length) };
	}
	const parsed = parseBatchOutput(resolved, outcome.text);
	if (!parsed.ok) {
		const found = [
			closedFinding(binding, toolId, "CDX-E207", "output is unusable"),
		];
		return { findings: found, event: event(outcome.code, found.length) };
	}
	const found = attributeFindings(binding, resolved, parsed.value);
	return { findings: found, event: event(outcome.code, found.length) };
}
