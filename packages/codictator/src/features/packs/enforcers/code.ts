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
	resolveArchBoundaries,
	resolveArchModuleMapped,
	resolveArchModuleSize,
	resolveArchNoCycles,
	resolveArchProfileDeclared,
	resolveArchPublicEntry,
	resolveCompilerStrict,
} from "./arch-guards.ts";
import {
	resolveBranchProtection,
	resolveCiActionsPinned,
	resolveCiPresent,
	resolveCiRequiredCheck,
	resolveConventionalCommit,
} from "./ci-guards.ts";
import {
	resolveComplexity,
	resolveFunctionSize,
	resolveNoGuardRemoval,
	resolveRatchetTouchedImproves,
} from "./code-health.ts";
import {
	resolveDepExactPin,
	resolveDepLatestStable,
	resolveDepLockfile,
	resolveDepNewNeedsReason,
} from "./deps-guards.ts";
import {
	resolveDepLicense,
	resolveDepNoDeprecated,
	resolveDepNoVulnerable,
	resolveDepOnePerCapability,
} from "./deps-policy-guards.ts";
import {
	resolveDocNoCorpusCounts,
	resolveDocOneLevel,
	resolveDocPlacement,
	resolveDocRouterLeaf,
	resolveDocSingleOwner,
} from "./docs-guards.ts";
import {
	resolveDocBreadth,
	resolveDocDensity,
	resolveDocLinksValid,
	resolveDocNoInlineChangelog,
} from "./docs-guards-measures.ts";
import {
	resolveAgentAssetsPresent,
	resolveCustomPackSelftest,
	resolveEngineVersionMatch,
	resolveGuardrailManifest,
	resolveHooksActive,
	resolvePerfBudgets,
	resolveWaiversValid,
} from "./gate-guards.ts";
import { resolveNoSpeculativeAbstraction } from "./health-abstraction.ts";
import { resolveDuplication } from "./health-duplication.ts";
import { resolveDeadCode } from "./health-refs.ts";
import {
	resolveNoAssertionLoss,
	resolveNoBaselineRaise,
	resolveNoFixtureShrink,
	resolveNoNewSuppressions,
	resolveNoSkippedTests,
	resolveNoThresholdLowering,
	resolveTestCommandIntact,
} from "./integrity-guards.ts";
import {
	resolveNoBypass,
	resolveRepoHygiene,
} from "./integrity-guards-repo.ts";
import {
	resolveBugRegistry,
	resolveBugRowsImmutable,
	resolveDiagnoseBeforeFix,
	resolveFileNaming,
	resolveHistoryAppendOnly,
	resolveHistoryEntry,
	resolveHistoryEntryComplete,
} from "./records-guards.ts";
import { resolveRemediationStepSize } from "./remediation-guards.ts";
import { resolveNoSecretReads, resolveNoSecrets } from "./secret-scan.ts";
import { resolveDangerousShell } from "./shell-analyse.ts";
import {
	resolveContextHardBand,
	resolveContextSoftBand,
	resolveGraphBeforeScan,
	resolveMcpDeclared,
	resolveReadDedupe,
	resolveSessionToolCallLimit,
} from "./steering-guards.ts";
import {
	resolveCoverageFloor,
	resolveRedBeforeGreen,
	resolveRegressionTestForFix,
	resolveSpecTrace,
	resolveTestKindsByScenario,
} from "./testing-guards.ts";
import { resolveTsLint, resolveTsTypecheck } from "./ts-checks.ts";
import { resolveTsNoPhantomImport } from "./ts-phantom.ts";
import { resolveTsSecurityPatterns } from "./ts-security-patterns.ts";
import {
	resolveLoopBreaker,
	resolveReviewGate,
	resolveReviewRoundCap,
	resolveWorkflowGates,
	resolveWritesWithinPlan,
} from "./workflow-guards.ts";
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
	"core/duplication": resolveDuplication,
	"core/no-speculative-abstraction": resolveNoSpeculativeAbstraction,
	"core/no-guard-removal": resolveNoGuardRemoval,
	"core/ratchet-touched-improves": resolveRatchetTouchedImproves,
	"ts/typecheck": resolveTsTypecheck,
	"ts/lint": resolveTsLint,
	"ts/no-phantom-import": resolveTsNoPhantomImport,
	"core/no-skipped-tests": resolveNoSkippedTests,
	"core/no-new-suppressions": resolveNoNewSuppressions,
	"core/no-fixture-shrink": resolveNoFixtureShrink,
	"core/no-threshold-lowering": resolveNoThresholdLowering,
	"core/test-command-intact": resolveTestCommandIntact,
	"core/no-baseline-raise": resolveNoBaselineRaise,
	"core/no-assertion-loss": resolveNoAssertionLoss,
	"core/spec-trace": resolveSpecTrace,
	"core/red-before-green": resolveRedBeforeGreen,
	"core/test-kinds-by-scenario": resolveTestKindsByScenario,
	"core/regression-test-for-fix": resolveRegressionTestForFix,
	"core/coverage-floor": resolveCoverageFloor,
	"core/arch-profile-declared": resolveArchProfileDeclared,
	"core/arch-module-mapped": resolveArchModuleMapped,
	"core/arch-boundaries": resolveArchBoundaries,
	"core/arch-public-entry": resolveArchPublicEntry,
	"core/arch-no-cycles": resolveArchNoCycles,
	"core/arch-module-size": resolveArchModuleSize,
	"core/compiler-strict": resolveCompilerStrict,
	"core/history-entry": resolveHistoryEntry,
	"core/history-append-only": resolveHistoryAppendOnly,
	"core/history-entry-complete": resolveHistoryEntryComplete,
	"core/bug-registry": resolveBugRegistry,
	"core/bug-rows-immutable": resolveBugRowsImmutable,
	"core/diagnose-before-fix": resolveDiagnoseBeforeFix,
	"core/workflow-gates": resolveWorkflowGates,
	"core/writes-within-plan": resolveWritesWithinPlan,
	"core/no-bypass": resolveNoBypass,
	"core/repo-hygiene": resolveRepoHygiene,
	"core/file-naming": resolveFileNaming,
	"core/loop-breaker": resolveLoopBreaker,
	"core/review-gate": resolveReviewGate,
	"core/review-round-cap": resolveReviewRoundCap,
	"core/doc-placement": resolveDocPlacement,
	"core/doc-one-level": resolveDocOneLevel,
	"core/doc-router-leaf": resolveDocRouterLeaf,
	"core/doc-breadth": resolveDocBreadth,
	"core/doc-density": resolveDocDensity,
	"core/doc-links-valid": resolveDocLinksValid,
	"core/doc-no-inline-changelog": resolveDocNoInlineChangelog,
	"core/doc-no-corpus-counts": resolveDocNoCorpusCounts,
	"core/doc-single-owner": resolveDocSingleOwner,
	"core/dep-exact-pin": resolveDepExactPin,
	"core/dep-lockfile": resolveDepLockfile,
	"core/dep-no-vulnerable": resolveDepNoVulnerable,
	"core/dep-no-deprecated": resolveDepNoDeprecated,
	"core/dep-latest-stable": resolveDepLatestStable,
	"core/dep-new-needs-reason": resolveDepNewNeedsReason,
	"core/dep-one-per-capability": resolveDepOnePerCapability,
	"core/dep-license": resolveDepLicense,
	"core/remediation-step-size": resolveRemediationStepSize,
	"core/context-soft-band": resolveContextSoftBand,
	"core/context-hard-band": resolveContextHardBand,
	"core/session-tool-call-limit": resolveSessionToolCallLimit,
	"core/read-dedupe": resolveReadDedupe,
	"core/graph-before-scan": resolveGraphBeforeScan,
	"core/mcp-declared": resolveMcpDeclared,
	"core/agent-assets-present": resolveAgentAssetsPresent,
	"core/ci-present": resolveCiPresent,
	"core/ci-actions-pinned": resolveCiActionsPinned,
	"core/ci-required-check": resolveCiRequiredCheck,
	"core/branch-protection": resolveBranchProtection,
	"core/conventional-commit": resolveConventionalCommit,
	"core/perf-budgets": resolvePerfBudgets,
	"core/guardrail-manifest": resolveGuardrailManifest,
	"core/hooks-active": resolveHooksActive,
	"core/engine-version-match": resolveEngineVersionMatch,
	"core/waivers-valid": resolveWaiversValid,
	"core/custom-pack-selftest": resolveCustomPackSelftest,
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
