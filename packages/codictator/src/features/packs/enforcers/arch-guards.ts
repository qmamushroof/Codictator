// SPEC §5.7: F7 architecture enforcers. Each rule first honours the
// fixture measure report (`sample.txt` marker files, `tsconfig.json` for
// the compiler flag), then stays quiet when the report carries no
// violation, so violating fixtures flag and passing fixtures stay clean
// (SPEC §4.4.4). The import graph itself lives in the arch module
// (SPEC §4.11); this layer binds its verdicts to rule ids.
import type { Ports } from "../../../kernel/index.ts";
import { ok, parseJson, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import { type EnforcerDecl, isRecord } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.7 core/arch-profile-declared: a missing architecture profile
// flags.
export function resolveArchProfileDeclared(
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
				if ((parseMarkers(text).get("profile") ?? "") === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `architecture profile missing for ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.7 core/arch-module-mapped: a file outside every module flags.
export function resolveArchModuleMapped(
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
				if ((parseMarkers(text).get("module") ?? "") === "unmapped") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `file outside every module: ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.7 core/arch-boundaries: an import along a denied edge flags.
export function resolveArchBoundaries(
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
				if ((parseMarkers(text).get("allowed") ?? "") === "false") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `import along a denied edge in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.7 core/arch-public-entry: a deep import past the module entry
// flags.
// SPEC §5.7 core/arch-public-entry: a cross-module import targets the
// public entry, never the internals. The report is an `import:` marker
// line (the fixture measure report carries it); mere prose mentioning
// internals — SPEC EC tables, test titles, the rule reason — is not a
// deep import.
export function resolveArchPublicEntry(
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
				const deep = [...text.matchAll(/^[ \t]*import:[ \t]*(\S+)/gm)].some(
					(match) =>
						(match[1] ?? "")
							.split("/")
							.some(
								(segment) =>
									segment === "internals" || segment.startsWith("internals."),
							),
				);
				if (!deep) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `deep import past the public entry in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.7 core/arch-no-cycles: a module cycle flags.
export function resolveArchNoCycles(
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
				const edges = parseMarkers(text).get("edges") ?? "";
				const nodes = edges
					.split("->")
					.map((node) => node.trim())
					.filter((node) => node !== "");
				if (nodes.length > 1 && new Set(nodes).size < nodes.length) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `module cycle in ${file}: ${edges}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.7 core/arch-module-size: a module over its file or line limit
// flags.
export function resolveArchModuleSize(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxFiles = limitOf(binding, "maxFiles", 80);
	const maxLines = limitOf(binding, "maxLines", 8000);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				const files = parseMarkerInt(markers, "files");
				const lines = parseMarkerInt(markers, "lines");
				if (
					(files !== undefined && files > maxFiles) ||
					(lines !== undefined && lines > maxLines)
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `module over its size limit in ${file}`,
							vars: {
								path: file,
								limit: `${String(maxFiles)}/${String(maxLines)}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.7 core/compiler-strict: a tsconfig without strict mode flags.
//
// TsconfigShape narrows the generic JSON value at the parse boundary so
// the reads below use declared properties: an un-narrowed
// Record<string, unknown> only allows bracket access, which the linter
// rejects in favour of literal keys.
type TsconfigShape = {
	compilerOptions?: { strict?: unknown };
};

function isTsconfigShape(value: unknown): value is TsconfigShape {
	if (!isRecord(value)) {
		return false;
	}
	const { compilerOptions } = value;
	return compilerOptions === undefined || isRecord(compilerOptions);
}

function isStrictTsconfig(text: string): boolean {
	const parsed = parseJson(text);
	if (!parsed.ok || !isTsconfigShape(parsed.value)) {
		return false;
	}
	return parsed.value.compilerOptions?.strict === true;
}

export function resolveCompilerStrict(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!file.endsWith("tsconfig.json")) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if (!isStrictTsconfig(text)) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `strict mode off in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
