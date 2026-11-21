// SPEC §5.7: F7 architecture enforcers. Each rule first honours the
// fixture measure report (`sample.txt` marker files), then stays quiet when
// the report carries no violation, so violating fixtures flag and passing
// fixtures stay clean (SPEC §4.4.4). The four L1 rules also judge a live
// write against the configured module map (arch-live.ts); the import graph
// itself lives in the arch module (SPEC §4.11).
import type { Ports, Result } from "../../../kernel/index.ts";
import { ok } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";

export {
	resolveArchModuleSize,
	resolveCompilerStrict,
} from "./arch-fitness-guards.ts";

import { archLiveFindings } from "./arch-live.ts";
import { bindRule, findingFor } from "./binding.ts";
import { parseMarkers } from "./health-measures.ts";
import { scopeTextRule } from "./scope-text-rule.ts";

// SPEC §4.11.4: the four L1 rules judge a live write against the configured
// module map beside their fixture marker reports.
function withArchLive(
	ports: Ports,
	rule: PackRule,
	base: Result<Enforcer>,
): Result<Enforcer> {
	if (!base.ok) {
		return base;
	}
	const binding = bindRule(rule);
	const marker = base.value;
	return ok({
		...marker,
		check: async (ctx, params) => [
			...(await marker.check(ctx, params)),
			...(await archLiveFindings(ports, ctx, binding, marker.id)),
		],
	});
}

function flag(
	findings: Array<Finding>,
	binding: Parameters<typeof findingFor>[0],
	file: string,
	message: string,
): void {
	findings.push(
		findingFor(binding, { path: file, message, vars: { path: file } }),
	);
}

// SPEC §5.7 core/arch-profile-declared: a missing architecture profile
// flags.
export function resolveArchProfileDeclared(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeTextRule(decl, rule, ports, (binding, file, text, findings) => {
		if ((parseMarkers(text).get("profile") ?? "") === "none") {
			flag(findings, binding, file, `architecture profile missing for ${file}`);
		}
	});
}

// SPEC §5.7 core/arch-module-mapped: a file outside every module flags.
export function resolveArchModuleMapped(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return withArchLive(
		ports,
		rule,
		scopeTextRule(decl, rule, ports, (binding, file, text, findings) => {
			if ((parseMarkers(text).get("module") ?? "") === "unmapped") {
				flag(findings, binding, file, `file outside every module: ${file}`);
			}
		}),
	);
}

// SPEC §5.7 core/arch-boundaries: an import along a denied edge flags.
export function resolveArchBoundaries(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return withArchLive(
		ports,
		rule,
		scopeTextRule(decl, rule, ports, (binding, file, text, findings) => {
			if ((parseMarkers(text).get("allowed") ?? "") === "false") {
				flag(findings, binding, file, `import along a denied edge in ${file}`);
			}
		}),
	);
}

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
	return withArchLive(
		ports,
		rule,
		scopeTextRule(decl, rule, ports, (binding, file, text, findings) => {
			const deep = [...text.matchAll(/^[ \t]*import:[ \t]*(\S+)/gm)].some(
				(match) =>
					(match[1] ?? "")
						.split("/")
						.some(
							(segment) =>
								segment === "internals" || segment.startsWith("internals."),
						),
			);
			if (deep) {
				flag(
					findings,
					binding,
					file,
					`deep import past the public entry in ${file}`,
				);
			}
		}),
	);
}

// SPEC §5.7 core/arch-no-cycles: a module cycle flags.
export function resolveArchNoCycles(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return withArchLive(
		ports,
		rule,
		scopeTextRule(decl, rule, ports, (binding, file, text, findings) => {
			const edges = parseMarkers(text).get("edges") ?? "";
			const nodes = edges
				.split("->")
				.map((node) => node.trim())
				.filter((node) => node !== "");
			if (nodes.length > 1 && new Set(nodes).size < nodes.length) {
				flag(findings, binding, file, `module cycle in ${file}: ${edges}`);
			}
		}),
	);
}
