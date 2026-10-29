// SPEC §5.6 code health: function-size, complexity, no-guard-removal and
// ratchet-touched-improves (dead-code lives in health-refs). Self-contained
// like the security enforcers (§3.3); every rule first honours the fixture
// measure reports (`sample.txt` marker files), then judges source files
// with the shared measures.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	isTestPath,
	type RuleBinding,
	selectFiles,
} from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import {
	baseEnforcer,
	countCyclomatic,
	isMarkerFile,
	isTsFile,
	limitOf,
	loadScopeText,
	measureFunctionSpans,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.6 core/function-size: functions stay under maxLines lines.
export function resolveFunctionSize(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxLines = limitOf(binding, "maxLines", 40);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if (isMarkerFile(file)) {
					const lines = parseMarkerInt(parseMarkers(text), "function-lines");
					if (lines !== undefined && lines > maxLines) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: 1,
								message: `function over the size limit in ${file}`,
								vars: {
									path: file,
									line: "1",
									limit: String(maxLines),
									value: String(lines),
								},
							}),
						);
					}
					continue;
				}
				if (!isTsFile(file) || isTestPath(file)) {
					continue;
				}
				findings.push(...oversizedSpans(binding, file, text, maxLines));
			}
			return findings;
		}),
	);
}

function oversizedSpans(
	binding: RuleBinding,
	file: string,
	text: string,
	maxLines: number,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const span of measureFunctionSpans(text)) {
		if (span.lines > maxLines) {
			findings.push(
				findingFor(binding, {
					path: file,
					line: span.line,
					message: `function over the size limit at ${file}:${String(span.line)}`,
					vars: {
						path: file,
						line: String(span.line),
						limit: String(maxLines),
						value: String(span.lines),
					},
				}),
			);
		}
	}
	return findings;
}

// SPEC §5.6 core/complexity: cyclomatic complexity stays under
// maxCyclomatic per function body. Whole-file counting flags every module
// with more than a couple of branches, so the measure runs over each
// function span the §6.1 brace matcher finds.
export function resolveComplexity(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxCyclomatic = limitOf(binding, "maxCyclomatic", 10);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if (isMarkerFile(file)) {
					const value = parseMarkerInt(parseMarkers(text), "cyclomatic");
					if (value !== undefined && value > maxCyclomatic) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: 1,
								message: `complexity over the limit in ${file}`,
								vars: {
									path: file,
									line: "1",
									limit: String(maxCyclomatic),
									value: String(value),
								},
							}),
						);
					}
					continue;
				}
				if (!isTsFile(file) || isTestPath(file)) {
					continue;
				}
				const lines = text.split("\n");
				findings.push(
					...overComplexSpans(binding, file, text, lines, maxCyclomatic),
				);
			}
			return findings;
		}),
	);
}

function overComplexSpans(
	binding: RuleBinding,
	file: string,
	text: string,
	lines: Array<string>,
	maxCyclomatic: number,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const span of measureFunctionSpans(text)) {
		const body = blankCode(
			lines.slice(span.line - 1, span.line - 1 + span.lines).join("\n"),
		);
		const value = countCyclomatic(body);
		if (value > maxCyclomatic) {
			findings.push(
				findingFor(binding, {
					path: file,
					line: span.line,
					message: `complexity over the limit at ${file}:${String(span.line)}`,
					vars: {
						path: file,
						line: String(span.line),
						limit: String(maxCyclomatic),
						value: String(value),
					},
				}),
			);
		}
	}
	return findings;
}

// SPEC §5.6 core/no-guard-removal: no deleted validation, throw or assert
// in a living function. The enforcer sees current file content only, so
// the fixture measure report carries the removal; without a base diff
// there is nothing to judge and the rule stays quiet.
export function resolveNoGuardRemoval(
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
				const removed = parseMarkers(text).get("removed") ?? "";
				const isGuardRemoval =
					removed.length > 0 &&
					removed !== "none" &&
					/throw|assert|\.parse\(|valid|guard|check|require/i.test(removed);
				if (isGuardRemoval) {
					findings.push(
						findingFor(binding, {
							path: file,
							line: 1,
							message: `guard removed in ${file}: ${removed}`,
							vars: { path: file, line: "1", value: removed },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.6 core/ratchet-touched-improves: touching a file lowers at
// least one ratchet metric by minDecrement. The delta rides the fixture
// measure report; without baseline data there is nothing to compare.
export function resolveRatchetTouchedImproves(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const minDecrement = limitOf(binding, "minDecrement", 1);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const delta = parseMarkerInt(parseMarkers(text), "touched-delta");
				if (delta !== undefined && delta + minDecrement > 0) {
					findings.push(
						findingFor(binding, {
							path: file,
							line: 1,
							message: `touched file ${file} improves no ratchet metric`,
							vars: {
								path: file,
								line: "1",
								limit: String(minDecrement),
								value: String(delta),
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}
