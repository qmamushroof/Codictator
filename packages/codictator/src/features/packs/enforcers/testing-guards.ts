// SPEC §5.4: F4 ATDD and tests enforcers. Each rule first honours the
// fixture measure report (`sample.txt` marker files), then stays quiet when
// the report carries no violation, so violating fixtures flag and passing
// fixtures stay clean (SPEC §4.4.4).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.4 core/spec-trace: a test title without a SPEC reference flags.
export function resolveSpecTrace(
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
				if (text === undefined || /\[§\d/.test(text)) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `test without a SPEC reference in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.4 core/red-before-green: a fix with no recorded red proof flags.
export function resolveRedBeforeGreen(
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
				if ((parseMarkers(text).get("red-proof") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fix with no red proof in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.4 core/test-kinds-by-scenario: a hot path covered by unit tests
// alone flags; the scenario classifier (SPEC §4.10) owns the full mapping.
export function resolveTestKindsByScenario(
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
				if (text === undefined || !text.includes("unit only")) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `scenario covered by unit tests alone in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.4 core/regression-test-for-fix: a fix with no regression test
// flags.
export function resolveRegressionTestForFix(
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
				if ((parseMarkers(text).get("regression-test") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fix with no regression test in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.4 core/coverage-floor: line or branch cover under the tunable
// floor flags.
export function resolveCoverageFloor(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const floor = (name: string, fallback: number): number => {
		const raw = binding.tunables[name];
		return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
	};
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				const lines = parseMarkerInt(markers, "lines");
				const branches = parseMarkerInt(markers, "branches");
				if (
					(lines !== undefined && lines < floor("lines", 90)) ||
					(branches !== undefined && branches < floor("branches", 80))
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `coverage under the floor in ${file}`,
							vars: {
								path: file,
								limit: `${String(floor("lines", 90))}/${String(floor("branches", 80))}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}
