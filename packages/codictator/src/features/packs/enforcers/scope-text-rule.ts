// One resolver skeleton for a rule that judges the text of each scope file
// the rule's globs select: load it (a read finding stands for an unreadable
// file) and hand it to the judge. The arch fitness, profile and mapping
// resolvers and the file-level CI resolvers share it, so none repeats the
// scope loop (core/duplication).
import type { Ports, Result } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { type RuleBinding, selectFiles } from "./binding.ts";
import { loadScopeText, scopeMarkerTexts } from "./health-measures.ts";
import { scanEnforcer } from "./marker-scan.ts";

export function scopeTextRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	judge: (
		binding: RuleBinding,
		file: string,
		text: string,
		findings: Array<Finding>,
	) => void,
	accept: (file: string) => boolean = () => true,
): Result<Enforcer> {
	return scanEnforcer(decl, rule, async (ctx, binding, findings) => {
		for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
			if (!accept(file)) {
				continue;
			}
			const text = await loadScopeText(ports, binding, file, findings);
			if (text !== undefined) {
				judge(binding, file, text, findings);
			}
		}
	});
}

// The marker-report twin: each scope file's self-test markers (§4.4.1) go to
// the judge, then `rest` may judge real paths in the same pass.
export function scopeMarkerRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	judge: (
		binding: RuleBinding,
		file: string,
		markers: Map<string, string>,
		findings: Array<Finding>,
	) => void,
	rest?: (
		ctx: CheckContext,
		binding: RuleBinding,
		findings: Array<Finding>,
	) => void,
): Result<Enforcer> {
	return scanEnforcer(decl, rule, async (ctx, binding, findings) => {
		for (const { file, markers } of await scopeMarkerTexts(
			ports,
			binding,
			ctx,
			findings,
		)) {
			judge(binding, file, markers, findings);
		}
		rest?.(ctx, binding, findings);
	});
}
