// SPEC §5.12 F16 plus §5.11-adjacent gate checks: fixture-shaped marker
// evaluators for the integrity, asset and pack code enforcers. Each reads
// the self-test marker report (§4.4.1 sample.txt/engine.json files) and
// answers whether the rule fires, so the pack self-test (§4.4.4) drives
// them while the live reads (workflow files, manifest bytes) stay in
// their owning modules (§3.3 forbids packs from importing them).
// core/ci-required-check stays deferred: its marker table names
// lint/typecheck/test while SPEC §4.15.2 requires the verify check, so
// wiring it would settle a SPEC contradiction in code.
import type { Ports } from "../../../kernel/index.ts";
import { ok, parseJson, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	readErrorFinding,
	selectFiles,
	tunableStringList,
} from "./binding.ts";
import {
	baseEnforcer,
	loadScopeText,
	parseMarkerInt,
	scopeMarkerTexts,
} from "./health-measures.ts";

// SPEC §4.6.6 core/agent-assets-present: every required helper must be
// present; the tunable defaults to knowledge-graph and token-saver (§5.12).
export function resolveAgentAssetsPresent(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const required = tunableStringList(binding, "requiredHelpers") ?? [
		"knowledge-graph",
		"token-saver",
	];
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const present = new Set(
					(markers.get("helpers") ?? "")
						.split(",")
						.map((entry) => entry.trim())
						.filter((entry) => entry !== ""),
				);
				const missing = required.filter((name) => !present.has(name));
				if (missing.length > 0) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `required helper assets missing: ${missing.join(", ")}`,
							vars: { path: file, detail: missing.join(", ") },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §9.3 core/perf-budgets: a measured p95 past the declared budget
// flags; inside the budget stays quiet.
export function resolvePerfBudgets(
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
				const rawP95 = markers.get("hook-p95-ms") ?? "";
				const rawBudget = markers.get("budget-ms") ?? "";
				const p95 = Number.parseFloat(rawP95);
				const budget = Number.parseFloat(rawBudget);
				if (Number.isFinite(p95) && Number.isFinite(budget) && p95 > budget) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `hook p95 of ${rawP95}ms is over the ${rawBudget}ms budget`,
							vars: {
								path: file,
								detail: `hook p95 ${rawP95}ms`,
								limit: `${rawBudget}ms`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.14.2 core/guardrail-manifest: a missing manifest flags.
export function resolveGuardrailManifest(
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
				const manifest = markers.get("manifest") ?? "";
				if (manifest === "" || manifest === "missing") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "guardrail manifest missing",
							vars: { path: file, detail: "the guardrail manifest" },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.14.2 core/hooks-active: hooks not installed flags.
export function resolveHooksActive(
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
				const hooks = markers.get("hooks") ?? "";
				if (hooks === "" || hooks === "not installed") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "git hooks not installed",
							vars: { path: file, detail: "the git hooks" },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.14.2 core/engine-version-match: the declared version must equal
// the installed engine; a pack ahead of the engine flags.
export function resolveEngineVersionMatch(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (file !== "engine.json" && !file.endsWith("/engine.json")) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const parsed = parseJson(text);
				if (!parsed.ok) {
					findings.push(readErrorFinding(binding, file, parsed.error, "parse"));
					continue;
				}
				const record = (
					typeof parsed.value === "object" && parsed.value !== null
						? parsed.value
						: {}
				) as { readonly engine?: unknown; readonly pack?: unknown };
				const engine = record.engine;
				const pack = record.pack;
				if (typeof engine !== "string" || typeof pack !== "string") {
					continue;
				}
				if (engine !== pack) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `pack version ${pack} does not match the engine ${engine}`,
							vars: { path: file, value: engine },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.3.4 core/waivers-valid: a waiver past the pack's maxWaiverDays
// (core: 90, §5.12) flags.
export function resolveWaiversValid(
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
				const days = parseMarkerInt(markers, "waiver-days");
				const max = parseMarkerInt(markers, "max") ?? 90;
				if (days !== undefined && days > max) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `waiver at ${String(days)} days is past the ${String(max)} day bound`,
							vars: { path: file, detail: `waiver at ${String(days)} days` },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.4.7 core/custom-pack-selftest: a changed custom pack whose
// self-test did not pass flags.
export function resolveCustomPackSelftest(
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
				const changed = markers.get("changed") ?? "";
				const tested = markers.get("self-test") ?? "";
				if (changed === "yes" && tested !== "passed") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "changed custom pack with no passing self-test",
							vars: { path: file, detail: "the changed custom pack" },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
