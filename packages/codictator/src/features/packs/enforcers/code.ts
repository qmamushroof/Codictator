// SPEC §4.4.3 step 4: the code-enforcer dispatcher. Parametric (§4.4.6)
// and external (§4.4.5) kinds resolve in their own modules; kind "code"
// with a security or language owner resolves here, one enforcer per
// referencing rule so findings carry the rule id the self-test asserts.
// Owners landing in later phases resolve undefined and the registry keeps
// them deferred fail-closed (CDX-E901).
import type { Ports, Result } from "../../../kernel/index.ts";
import { ok } from "../../../kernel/index.ts";
import type { Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	resolveComplexity,
	resolveFunctionSize,
	resolveNoGuardRemoval,
	resolveRatchetTouchedImproves,
} from "./code-health.ts";
import { resolveDeadCode } from "./health-refs.ts";
import { resolveNoSecretReads, resolveNoSecrets } from "./secret-scan.ts";
import { resolveDangerousShell } from "./shell-analyse.ts";
import { resolveTsLint, resolveTsTypecheck } from "./ts-checks.ts";
import { resolveTsNoPhantomImport } from "./ts-phantom.ts";
import { resolveTsSecurityPatterns } from "./ts-security-patterns.ts";
import { resolveWriteConfinement } from "./write-confine.ts";

type CodeResolver = (
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) => Result<Enforcer>;

const CODE_RESOLVERS: Readonly<Record<string, CodeResolver>> = {
	"core/no-secrets": resolveNoSecrets,
	"core/no-secret-reads": resolveNoSecretReads,
	"core/dangerous-shell": resolveDangerousShell,
	"core/write-confinement": resolveWriteConfinement,
	"ts/security-patterns": resolveTsSecurityPatterns,
	"core/function-size": resolveFunctionSize,
	"core/complexity": resolveComplexity,
	"core/dead-code": resolveDeadCode,
	"core/no-guard-removal": resolveNoGuardRemoval,
	"core/ratchet-touched-improves": resolveRatchetTouchedImproves,
	"ts/typecheck": resolveTsTypecheck,
	"ts/lint": resolveTsLint,
	"ts/no-phantom-import": resolveTsNoPhantomImport,
};

// SPEC §4.4.3 step 4: one enforcer per referencing rule. An unknown rule
// id resolves undefined and the registry defers it; a resolver failure
// fails the load like any other parametric narrowing error.
export function resolveCodeEnforcer(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer | undefined> {
	const resolver = CODE_RESOLVERS[rule.id];
	if (resolver === undefined) {
		return ok(undefined);
	}
	return resolver(decl, rule, ports);
}
