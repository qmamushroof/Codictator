// SPEC §4.4.5 sarif (2.1.0) output. Every result needs a rule id; entries
// the pack cannot attribute are dropped, escapes counted for EC-9.
import { ok, parseJson, type Result } from "../../../kernel/index.ts";
import { field, isRecord } from "../manifest.ts";
import {
	type ParsedToolFinding,
	type ParsedToolOutput,
	parseError,
	pushEntry,
} from "./external-output.ts";

function sarifRuleId(
	result: Record<string, unknown>,
	run: Record<string, unknown>,
): string | undefined {
	const direct: unknown = field(result, "ruleId");
	if (typeof direct === "string" && direct.length > 0) {
		return direct;
	}
	const tool: unknown = field(run, "tool");
	if (!isRecord(tool)) {
		return undefined;
	}
	const driver: unknown = field(tool, "driver");
	if (!isRecord(driver)) {
		return undefined;
	}
	const rules: unknown = field(driver, "rules");
	const index: unknown = field(result, "ruleIndex");
	if (!Array.isArray(rules) || typeof index !== "number") {
		return undefined;
	}
	const rule: unknown = rules[index];
	if (!isRecord(rule)) {
		return undefined;
	}
	const id: unknown = field(rule, "id");
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

function sarifLocation(result: Record<string, unknown>): {
	path: unknown;
	line: unknown;
} {
	const locations: unknown = field(result, "locations");
	if (!Array.isArray(locations)) {
		return { path: undefined, line: undefined };
	}
	const first: unknown = locations[0];
	if (!isRecord(first)) {
		return { path: undefined, line: undefined };
	}
	const physical: unknown = field(first, "physicalLocation");
	if (!isRecord(physical)) {
		return { path: undefined, line: undefined };
	}
	const artifact: unknown = field(physical, "artifactLocation");
	let uri: string | undefined;
	if (isRecord(artifact)) {
		const raw: unknown = field(artifact, "uri");
		if (typeof raw === "string" && raw.length > 0) {
			uri = raw;
		}
	}
	const region: unknown = field(physical, "region");
	let line: number | undefined;
	if (isRecord(region)) {
		const raw: unknown = field(region, "startLine");
		if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) {
			line = raw;
		}
	}
	return { path: uri, line };
}

export function parseSarif(text: string): Result<ParsedToolOutput> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return parseError("sarif output is not JSON");
	}
	if (!isRecord(parsed.value)) {
		return parseError("sarif output is not an object");
	}
	const runs: unknown = field(parsed.value, "runs");
	if (!Array.isArray(runs)) {
		return parseError("sarif output has no runs array");
	}
	const findings: Array<ParsedToolFinding> = [];
	const escapes = { count: 0 };
	for (const run of runs) {
		if (!isRecord(run)) {
			continue;
		}
		const results: unknown = field(run, "results");
		if (!Array.isArray(results)) {
			continue;
		}
		for (const entry of results) {
			if (!isRecord(entry)) {
				continue;
			}
			const toolRule = sarifRuleId(entry, run);
			if (toolRule === undefined) {
				continue;
			}
			const location = sarifLocation(entry);
			const detail: unknown = field(entry, "message");
			pushEntry(findings, escapes, {
				toolRule,
				path: location.path,
				line: location.line,
				message: isRecord(detail) ? field(detail, "text") : undefined,
			});
		}
	}
	return ok({ findings, escapes: escapes.count });
}
