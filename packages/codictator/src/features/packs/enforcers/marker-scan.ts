// Shared marker-first scan plus the marker+real resolver combinator for
// the split guard files (SPEC §5.6/§5.8/§5.9). One scan over scope files:
// skip non-markers, load each marker text once, visit it. Every resolver
// is one combinator call with its own predicate, so the split guard files
// share no duplicated resolver-skeleton token run.
import type { Ports, Result } from "../../../kernel/index.ts";
import { ok } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	type RuleBinding,
	selectFiles,
} from "./binding.ts";
import { isMarkerFile } from "./health-markers.ts";
import {
	baseEnforcer,
	loadScopeText,
	parseMarkers,
} from "./health-measures.ts";
import {
	type EffectiveFile,
	effectiveFiles,
	forEachEffectiveText,
} from "./pre-tool-files.ts";

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

// The resolver skeleton for a rule whose body only appends findings: bind
// the rule, run the body, return what it collected.
export function scanEnforcer(
	decl: EnforcerDecl,
	rule: PackRule,
	body: (
		ctx: CheckContext,
		binding: RuleBinding,
		findings: Array<Finding>,
	) => Promise<void>,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			await body(ctx, binding, findings);
			return findings;
		}),
	);
}

// One resolver for a whole-document rule over the effective files: the judge
// sees each file's complete text and pushes its findings.
export function documentRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	judge: (
		binding: RuleBinding,
		file: string,
		text: string,
		findings: Array<Finding>,
	) => void,
): Result<Enforcer> {
	return scanEnforcer(decl, rule, (ctx, binding, findings) =>
		forEachEffectiveText(
			ctx,
			ports,
			binding,
			findings,
			"document",
			(entry, text) => judge(binding, entry.path, text, findings),
		),
	);
}

// One resolver for a fixture-marker-only rule: each marker file's parsed
// markers yield at most one finding from the rule's judge.
export function markerFindingRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	judge: (
		binding: RuleBinding,
		file: string,
		markers: Map<string, string>,
	) => Finding | undefined,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			await forEachMarkerText(
				ports,
				binding,
				selectFiles(ctx.scope.files, binding.scopeGlobs),
				findings,
				(file, text) => {
					const found = judge(binding, file, parseMarkers(text));
					if (found !== undefined) {
						findings.push(found);
					}
				},
			);
			return findings;
		}),
	);
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
	// The pre-tool file adapter's view of the scope: disk files for L3/L4,
	// proposed targets with their call text for a live L1 write, none for a
	// read-only call.
	readonly effective: ReadonlyArray<EffectiveFile>;
	// A live L1 tool call carries its targets in the scope; diagnostic and
	// gate-leg scopes (verify, pre-commit, pre-push) carry files only. Only
	// a live write can owe the EC-1 no-task block.
	readonly hasToolTargets: boolean;
	// SPEC §4.12.3 L1 blocks a write, not a read: a read-only tool call
	// (scope toolAccess "read") owes no live-write workflow judging.
	readonly readOnlyTool: boolean;
}

// SPEC §4.3.2 + §4.7: at the pre-tool trigger the L1 scope carries no disk
// files, so the lexical tool targets judge in their place. The fallback only
// repoints the file pick — it never probes the disk, so not-yet-existing
// targets stay allowed unless a rule judges them lexically (§4.7.3).
function preToolFiles(ctx: CheckContext): ReadonlyArray<string> {
	if (ctx.trigger === "pre-tool" && ctx.scope.files.length === 0) {
		return ctx.scope.proposedPaths ?? [];
	}
	return ctx.scope.files;
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
			const files = selectFiles(preToolFiles(ctx), binding.scopeGlobs);
			const readOnlyTool =
				ctx.trigger === "pre-tool" && ctx.scope.toolAccess === "read";
			const hasToolTargets =
				ctx.trigger === "pre-tool" &&
				!readOnlyTool &&
				(ctx.scope.proposedPaths?.length ?? 0) > 0;
			const args = {
				ports,
				binding,
				files,
				findings,
				effective: effectiveFiles(ctx, binding.scopeGlobs),
				hasToolTargets,
				readOnlyTool,
			};
			await judgeMarkers(args);
			if (hasRealScope(files)) {
				await judgeReal(args);
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
			await judgeMarkers({
				ports,
				binding,
				files,
				findings,
				effective: [],
				hasToolTargets: false,
				readOnlyTool: false,
			});
			return findings;
		}),
	);
}
