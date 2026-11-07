// Shared marker-first scan plus the marker+real resolver combinator for
// the split guard files (SPEC §5.6/§5.8/§5.9). One scan over scope files:
// skip non-markers, load each marker text once, visit it. Every resolver
// is one combinator call with its own predicate, so the split guard files
// share no duplicated resolver-skeleton token run.
import type { Ports, Result } from "../../../kernel/index.ts";
import { ok } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles, type RuleBinding } from "./binding.ts";
import { isMarkerFile } from "./health-markers.ts";
import {
	baseEnforcer,
	loadScopeText,
	parseMarkers,
} from "./health-measures.ts";

export async function forEachMarkerText(
	ports: Ports,
	binding: RuleBinding,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
	visit: (file: string, text: string) => void | Promise<void>,
): Promise<void> {
	for (const file of files) {
		if (!isMarkerFile(file)) {
			continue;
		}
		const text = await loadScopeText(ports, binding, file, findings);
		if (text === undefined) {
			continue;
		}
		await visit(file, text);
	}
}

// Shared real-scope predicate: at least one non-marker file claims real
// judging. One predicate for the split guard files, not one copy each.
export function hasRealScope(files: ReadonlyArray<string>): boolean {
	return files.some((file) => !isMarkerFile(file));
}

export interface MarkerRealArgs {
	readonly ports: Ports;
	readonly binding: RuleBinding;
	readonly files: ReadonlyArray<string>;
	readonly findings: Array<Finding>;
}

// One resolver skeleton for every marker-first plus real-scope rule: judge
// the fixture markers, then the real scope when a non-marker file claims
// it. Resolvers pass only their two judges, so no resolver skeleton is
// repeated across the split guard files (core/duplication).
export function markerRealGuard(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	judgeMarkers: (args: MarkerRealArgs) => void | Promise<void>,
	judgeReal: (args: MarkerRealArgs) => void | Promise<void>,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			const files = selectFiles(ctx.scope.files, binding.scopeGlobs);
			await judgeMarkers({ ports, binding, files, findings });
			if (hasRealScope(files)) {
				await judgeReal({ ports, binding, files, findings });
			}
			return findings;
		}),
	);
}

// Marker predicate for key-gated fixture reports: flag files whose marker
// map holds key === "none". One predicate factory for every key-gated
// resolver, so the key-check lambda is written once (core/duplication).
export function markerKeyJudge(
	key: string,
	want: string,
	message: (file: string) => string,
): (args: MarkerRealArgs) => Promise<void> {
	return async (args) => {
		await forEachMarkerText(
			args.ports,
			args.binding,
			args.files,
			args.findings,
			(file, text) => {
				if ((parseMarkers(text).get(key) ?? "") === want) {
					args.findings.push(
						findingFor(args.binding, {
							path: file,
							message: message(file),
							vars: { path: file },
						}),
					);
				}
			},
		);
	};
}

// Marker predicate for regex-gated fixture reports: flag files whose text
// matches the pattern. One factory beside markerKeyJudge so regex-gated
// resolvers share no lambda run (core/duplication).
export function markerRegexJudge(
	pattern: RegExp,
	message: (file: string) => string,
): (args: MarkerRealArgs) => Promise<void> {
	return async (args) => {
		await forEachMarkerText(
			args.ports,
			args.binding,
			args.files,
			args.findings,
			(file, text) => {
				if (!pattern.test(text)) {
					return;
				}
				args.findings.push(
					findingFor(args.binding, {
						path: file,
						message: message(file),
						vars: { path: file },
					}),
				);
			},
		);
	};
}

// Marker-only resolver skeleton: fixture reports judge the scope and there
// is no real-scope branch. Same single-site rationale as markerRealGuard.
export function markerGuard(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	judgeMarkers: (args: MarkerRealArgs) => void | Promise<void>,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			const files = selectFiles(ctx.scope.files, binding.scopeGlobs);
			await judgeMarkers({ ports, binding, files, findings });
			return findings;
		}),
	);
}
