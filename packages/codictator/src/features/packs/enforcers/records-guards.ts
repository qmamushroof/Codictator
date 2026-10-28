// SPEC §5.8: F8 change-history and F15 defect enforcers. Each rule first
// honours the fixture measure report (`sample.txt` marker files), then stays
// quiet when the report carries no violation, so violating fixtures flag
// and passing fixtures stay clean (SPEC §4.4.4).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	loadScopeText,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.8 core/history-entry: a commit with no history entry flags.
export function resolveHistoryEntry(
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
				if ((parseMarkers(text).get("history") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `commit with no history entry in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.8 core/history-append-only: an edit to a history file flags;
// appending stays clean.
export function resolveHistoryAppendOnly(
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
				if (text === undefined || !text.includes("edited:")) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `history file edited in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.8 core/history-entry-complete: an entry missing a required field
// flags.
export function resolveHistoryEntryComplete(
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
				if ((parseMarkers(text).get("spec") ?? "") === "missing") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `history entry missing a field in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.8 core/bug-registry: a fix with no bug row flags.
export function resolveBugRegistry(
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
				if ((parseMarkers(text).get("bug-row") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fix with no bug row in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.8 core/bug-rows-immutable: an edit to a closed bug row flags;
// appending a note stays clean.
export function resolveBugRowsImmutable(
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
				if (text === undefined || !text.includes("edited:")) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `closed bug row edited in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.8 core/diagnose-before-fix: a fix with no recorded diagnosis
// flags.
export function resolveDiagnoseBeforeFix(
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
				if ((parseMarkers(text).get("diagnosis") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fix with no diagnosis in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
