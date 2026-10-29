// SPEC §5.1 F1 context and token hygiene: fixture-shaped marker
// evaluators for the steering-owned code enforcers. Each reads the
// self-test marker report (§4.4.1 sample.txt files) and answers whether
// the rule fires, so the pack self-test (§4.4.4) drives them while the
// live-session wiring (budgets, read cache, graph output) stays in the
// steering module (§3.3 forbids packs from importing it).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles, tunableNumber } from "./binding.ts";
import {
	baseEnforcer,
	isMarkerFile,
	loadScopeText,
	parseMarkerInt,
	scopeMarkerTexts,
} from "./health-measures.ts";

function parsePercent(
	markers: Map<string, string>,
	key: string,
): number | undefined {
	const raw = markers.get(key) ?? "";
	const match = raw.match(/(\d+(?:\.\d+)?)\s*%/);
	if (match === null) {
		return undefined;
	}
	const parsed = Number.parseFloat(match[1] ?? "");
	return Number.isFinite(parsed) ? parsed : undefined;
}

function checkpointed(markers: Map<string, string>): boolean {
	return (markers.get("checkpoint") ?? "none") !== "none";
}

// SPEC §4.6.4 core/context-soft-band: usage at or past softPercent with no
// checkpoint summary advises; below the band, or already checkpointed,
// stays quiet.
export function resolveContextSoftBand(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const soft = tunableNumber(binding, "softPercent") ?? 60;
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const percent = parsePercent(markers, "context-used");
				if (
					percent !== undefined &&
					percent >= soft &&
					!checkpointed(markers)
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `context at ${String(percent)}% is past the ${String(soft)}% soft band with no checkpoint`,
							vars: {
								path: file,
								detail: `${String(percent)}% with no checkpoint`,
								limit: String(soft),
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.6.4 core/context-hard-band: usage at or past hardPercent with no
// forced checkpoint flags checkpointRequired.
export function resolveContextHardBand(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const hard = tunableNumber(binding, "hardPercent") ?? 75;
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const percent = parsePercent(markers, "context-used");
				if (
					percent !== undefined &&
					percent >= hard &&
					!checkpointed(markers)
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `context at ${String(percent)}% is past the ${String(hard)}% hard band with no forced checkpoint`,
							vars: {
								path: file,
								detail: `${String(percent)}% with no checkpoint`,
								limit: String(hard),
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.6.4 core/session-tool-call-limit: calls past maxToolCalls flag.
export function resolveSessionToolCallLimit(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const cap = tunableNumber(binding, "maxToolCalls") ?? 300;
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const calls = parseMarkerInt(markers, "tool-calls");
				const limit = parseMarkerInt(markers, "limit") ?? cap;
				if (calls !== undefined && calls > limit) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `session made ${String(calls)} tool calls past the ${String(limit)} call limit`,
							vars: { path: file, limit: String(limit) },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.6.5 EC-10 core/read-dedupe: the same file twice flags; a first
// read, or reads of different files, stays quiet.
export function resolveReadDedupe(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const reads: Array<string> = [];
				for (const line of text.split("\n")) {
					const trimmed = line.trim();
					if (trimmed.startsWith("- ")) {
						reads.push(trimmed.slice(2).trim());
					}
				}
				const seen = new Set<string>();
				for (const read of reads) {
					if (seen.has(read)) {
						findings.push(
							findingFor(binding, {
								path: file,
								message: `repeat read of ${read} in one session`,
								vars: { path: read },
							}),
						);
						break;
					}
					seen.add(read);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.6.5 core/graph-before-scan: a full-repo scan while the graph is
// absent violates the graph-first order; a graph-guided scan, or one with
// the graph present, passes.
export function resolveGraphBeforeScan(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const scan = markers.get("scan") ?? "";
				const graph = markers.get("knowledge-graph") ?? "";
				if (scan.includes("full-repo") && graph !== "present") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "full-repo scan with no knowledge graph on disk",
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.6.5 core/mcp-declared: a tool call to a server the markers flag
// as undeclared violates; a declared one passes.
export function resolveMcpDeclared(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				if ((markers.get("declared") ?? "false") !== "true") {
					const tool = markers.get("tool") ?? "unknown server";
					findings.push(
						findingFor(binding, {
							path: file,
							message: `tool call to undeclared MCP server ${tool}`,
							vars: { path: file, detail: tool },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
