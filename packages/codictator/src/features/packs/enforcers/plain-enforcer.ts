import type { CheckContext, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, type RuleBinding } from "./binding.ts";

// The resolver preamble for a rule whose check keeps its one-argument form:
// one binding, one budget-carrying enforcer over the check built from it.
export function plainEnforcer(
	decl: EnforcerDecl,
	rule: PackRule,
	build: (
		binding: RuleBinding,
	) => (ctx: CheckContext) => Promise<Array<Finding>>,
) {
	const binding = bindRule(rule);
	return {
		ok: true as const,
		value: {
			id: rule.id,
			kinds: binding.triggers,
			budgetMs: decl.budgetMs,
			check: build(binding),
		},
	};
}
