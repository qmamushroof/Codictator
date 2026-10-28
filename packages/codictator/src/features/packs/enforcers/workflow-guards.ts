// SPEC §5.9: F9 workflow and F11 review enforcers. Each rule first honours
// the fixture measure report (`sample.txt` marker files), then stays quiet
// when the report carries no violation, so violating fixtures flag and
// passing fixtures stay clean (SPEC §4.4.4).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.9 core/workflow-gates: a skipped mandatory gate flags.
export function resolveWorkflowGates(
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
				if (text === undefined || !text.includes("skipped:")) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `mandatory gate skipped in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.9 core/writes-within-plan: a write no plan allows flags.
export function resolveWritesWithinPlan(
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
				if (text === undefined) {
					continue;
				}
				if ((parseMarkers(text).get("planned") ?? "") === "false") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `write outside the plan in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.9 core/loop-breaker: repeats past the tunable cap flag.
export function resolveLoopBreaker(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxRepeats = limitOf(binding, "maxRepeats", 3);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				const repeats = parseMarkerInt(markers, "repeats");
				const cap = parseMarkerInt(markers, "limit") ?? maxRepeats;
				if (repeats !== undefined && repeats > cap) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `loop past ${String(cap)} repeats in ${file}`,
							vars: { path: file, limit: String(cap) },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.9 core/review-gate: landing with no review flags.
export function resolveReviewGate(
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
				if (text === undefined) {
					continue;
				}
				if ((parseMarkers(text).get("review") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `landing with no review in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.9 core/review-round-cap: rounds past the tunable cap flag.
export function resolveReviewRoundCap(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxRounds = limitOf(binding, "maxRounds", 3);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				const rounds = parseMarkerInt(markers, "rounds");
				const cap = parseMarkerInt(markers, "cap") ?? maxRounds;
				if (rounds !== undefined && rounds > cap) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `review past ${String(cap)} rounds in ${file}`,
							vars: { path: file, limit: String(cap) },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
