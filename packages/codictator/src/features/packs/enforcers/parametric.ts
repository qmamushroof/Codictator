// SPEC §4.4.6 registry: the loader resolves every parametric decl to a
// real enforcer bound to its referencing rule. Per-kind behaviour lives in
// the sibling kind modules; this file owns the kind set and the dispatch.

import type { Ports } from "../../../kernel/index.ts";
import { err, ok, type Result } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindingError,
	bindRule,
	isUnboundArgs,
	type RuleBinding,
	tunableNumber,
} from "./binding.ts";
import { checkJsonKey, narrowJsonKeyArgs } from "./jsonkey.ts";
import {
	checkPatternForbid,
	checkPatternRequire,
	narrowPatternArgs,
} from "./pattern.ts";
import { checkPlacement, narrowPlacementArgs } from "./placement.ts";
import { checkRequired, narrowRequiredArgs } from "./required.ts";
import { checkSize, narrowSizeArgs } from "./sizes.ts";

const PARAMETRIC_KINDS: ReadonlyArray<string> = [
	"pattern-forbid",
	"pattern-require",
	"path-placement",
	"file-size",
	"file-required",
	"json-key",
];

export function isParametricKind(kind: string): boolean {
	return PARAMETRIC_KINDS.includes(kind);
}

function baseEnforcer(
	rule: PackRule,
	binding: RuleBinding,
	decl: EnforcerDecl,
): Pick<Enforcer, "id" | "kinds" | "budgetMs"> {
	return { id: rule.id, kinds: binding.triggers, budgetMs: decl.budgetMs };
}

// A decl with no binding stays deferred instead of failing the load, so
// frozen manifests keep loading while unbound enforcers stay inert. Only
// file-size can bind from rule tunables alone; path-placement with no
// config is a valid vacuous constraint.
function unboundDecl(decl: EnforcerDecl, binding: RuleBinding): boolean {
	if (!isUnboundArgs(decl.args)) {
		return false;
	}
	if (decl.kind === "path-placement") {
		return false;
	}
	if (decl.kind === "file-size") {
		return (
			tunableNumber(binding, "maxLines") === undefined &&
			tunableNumber(binding, "maxBytes") === undefined
		);
	}
	return true;
}

// SPEC §4.4.3 step 4: one enforcer per referencing rule, so findings carry
// the rule id the self-test asserts (CDX-E212/E213). An unbound decl
// resolves to undefined and the registry defers it; unknown kinds here
// are a wiring error and fail the load.
export function resolveParametric(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer | undefined> {
	const binding = bindRule(rule);
	if (unboundDecl(decl, binding)) {
		return ok(undefined);
	}
	switch (decl.kind) {
		case "pattern-forbid": {
			const config = narrowPatternArgs(decl.id, decl.args);
			if (!config.ok) {
				return err(config.error);
			}
			const resolved = config.value;
			return ok({
				...baseEnforcer(rule, binding, decl),
				check: (ctx: CheckContext) =>
					checkPatternForbid(ports, binding, resolved, ctx),
			});
		}
		case "pattern-require": {
			const config = narrowPatternArgs(decl.id, decl.args);
			if (!config.ok) {
				return err(config.error);
			}
			const resolved = config.value;
			return ok({
				...baseEnforcer(rule, binding, decl),
				check: (ctx: CheckContext) =>
					checkPatternRequire(ports, binding, resolved, ctx),
			});
		}
		case "path-placement": {
			const config = narrowPlacementArgs(decl.id, binding, decl.args);
			if (!config.ok) {
				return err(config.error);
			}
			const resolved = config.value;
			return ok({
				...baseEnforcer(rule, binding, decl),
				check: (ctx: CheckContext) =>
					Promise.resolve(checkPlacement(binding, resolved, ctx)),
			});
		}
		case "file-size": {
			const config = narrowSizeArgs(decl.id, binding, decl.args);
			if (!config.ok) {
				return err(config.error);
			}
			const resolved = config.value;
			return ok({
				...baseEnforcer(rule, binding, decl),
				check: (ctx: CheckContext) => checkSize(ports, binding, resolved, ctx),
			});
		}
		case "file-required": {
			const config = narrowRequiredArgs(decl.id, decl.args);
			if (!config.ok) {
				return err(config.error);
			}
			const resolved = config.value;
			return ok({
				...baseEnforcer(rule, binding, decl),
				check: () => checkRequired(ports, binding, resolved),
			});
		}
		case "json-key": {
			const config = narrowJsonKeyArgs(decl.id, decl.args);
			if (!config.ok) {
				return err(config.error);
			}
			const resolved = config.value;
			return ok({
				...baseEnforcer(rule, binding, decl),
				check: () => checkJsonKey(ports, binding, resolved),
			});
		}
		default: {
			return bindingError(
				decl.id,
				`names a non-parametric kind "${decl.kind}" for this resolver`,
			);
		}
	}
}
