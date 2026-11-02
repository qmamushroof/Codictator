// SPEC §4.13.8: the L4 pre-existing-findings rule. Floor findings present
// on the base block every PR except a fixing PR.
import type { Finding } from "../engine/index.ts";

// Floor rules (SPEC §5 tier column): no waiver, no off switch. A floor
// finding present on the base blocks every PR except a fixing PR.
const FLOOR_RULES: ReadonlySet<string> = new Set([
	"core/no-secrets",
	"core/no-secret-reads",
	"core/dangerous-shell",
	"core/write-confinement",
	"core/dep-exact-pin",
	"core/dep-lockfile",
	"core/dep-no-vulnerable",
	"core/dep-no-deprecated",
	"core/dep-new-needs-reason",
	"core/dep-one-per-capability",
	"core/dep-license",
	"core/spec-trace",
	"core/red-before-green",
	"core/test-kinds-by-scenario",
	"core/regression-test-for-fix",
	"core/no-assertion-loss",
	"core/no-guard-removal",
	"core/arch-boundaries",
	"core/arch-public-entry",
	"core/arch-no-cycles",
	"core/arch-module-mapped",
	"core/arch-profile-declared",
	"core/compiler-strict",
	"core/history-entry",
	"core/history-append-only",
	"core/history-entry-complete",
	"core/bug-registry",
	"core/bug-rows-immutable",
	"core/diagnose-before-fix",
	"core/workflow-gates",
	"core/writes-within-plan",
	"core/review-gate",
	"core/no-bypass",
	"core/repo-hygiene",
	"core/file-naming",
	"core/branch-protection",
	"core/ci-present",
	"core/ci-required-check",
	"core/ci-actions-pinned",
	"core/perf-budgets",
	"core/guardrail-manifest",
	"core/hooks-active",
	"core/engine-version-match",
	"core/waivers-valid",
	"core/custom-pack-selftest",
]);

function findingKey(finding: Finding): string {
	return `${finding.ruleId}\n${finding.path ?? ""}`;
}

// SPEC §4.13.8: a fixing PR lowers the finding's count to zero or by the
// plan step's expectedDelta and introduces no new finding. Ratchet findings
// never block a PR that leaves them unchanged and untouched (§4.3.5).
export function floorBlocksPr(
	base: ReadonlyArray<Finding>,
	head: ReadonlyArray<Finding>,
	expectedDelta = 1,
): { readonly blocked: boolean; readonly reasons: ReadonlyArray<string> } {
	const baseKeys = new Set(base.map(findingKey));
	const reasons: Array<string> = [];
	for (const finding of head) {
		if (!baseKeys.has(findingKey(finding)) && FLOOR_RULES.has(finding.ruleId)) {
			reasons.push(
				`new ${finding.ruleId} finding${finding.path === undefined ? "" : ` at ${finding.path}`}`,
			);
		}
	}
	const countBy = (findings: ReadonlyArray<Finding>, ruleId: string): number =>
		findings.filter((finding) => finding.ruleId === ruleId).length;
	for (const ruleId of FLOOR_RULES) {
		const before = countBy(base, ruleId);
		if (before === 0) {
			continue;
		}
		const after = countBy(head, ruleId);
		if (after !== 0 && before - after < expectedDelta) {
			reasons.push(
				`${ruleId} still counts ${after} of ${before} base findings`,
			);
		}
	}
	return { blocked: reasons.length > 0, reasons: [...reasons].sort() };
}
