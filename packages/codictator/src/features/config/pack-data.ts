// SPEC §5: the core pack's tunable parameters and floor rules, mirrored here
// so config validation (§4.2.2) can decide tightening without the pack
// loader (§4.4, a later phase). Each entry cites the §5 section that owns
// it; Phase 5 replaces this table with loaded pack data.
export type Stricter = "lower" | "higher" | "subset" | "superset" | "policy";

export interface NumericParam {
	readonly kind: "number";
	readonly default: number;
	readonly bound: number;
	readonly stricter: "lower" | "higher";
}

export interface SetParam {
	readonly kind: "set";
	readonly default: ReadonlyArray<string>;
	readonly stricter: "subset" | "superset";
}

export interface PolicyParam {
	readonly kind: "policy";
}

export type ParamSpec = NumericParam | SetParam | PolicyParam;

function numeric(
	defaultValue: number,
	bound: number,
	stricter: "lower" | "higher",
): NumericParam {
	return { kind: "number", default: defaultValue, bound, stricter };
}

function stringSet(
	defaultValue: ReadonlyArray<string>,
	stricter: "subset" | "superset",
): SetParam {
	return { kind: "set", default: defaultValue, stricter };
}

const POLICY: PolicyParam = { kind: "policy" };

// SPEC §5.1, §5.3, §5.4, §5.6, §5.7, §5.9, §5.10, §5.12: every tunable rule
// of the core pack. Defaults and bounds are the table values verbatim.
export const TUNABLE_PARAMS: Readonly<
	Record<string, Readonly<Record<string, ParamSpec>>>
> = {
	"core/context-soft-band": { softPercent: numeric(60, 70, "lower") },
	"core/context-hard-band": { hardPercent: numeric(75, 85, "lower") },
	"core/session-tool-call-limit": { maxToolCalls: numeric(300, 500, "lower") },
	"core/dep-latest-stable": {
		lagDays: numeric(30, 60, "lower"),
		majorLagDays: numeric(60, 120, "lower"),
		minReleaseAgeDays: numeric(7, 3, "higher"),
	},
	"core/dep-license": { allow: POLICY },
	"core/coverage-floor": {
		lines: numeric(90, 80, "higher"),
		branches: numeric(80, 70, "higher"),
	},
	"core/file-size": { maxLines: numeric(300, 500, "lower") },
	"core/function-size": { maxLines: numeric(40, 80, "lower") },
	"core/complexity": { maxCyclomatic: numeric(10, 15, "lower") },
	"core/duplication": { minTokens: numeric(50, 100, "lower") },
	"core/ratchet-touched-improves": { minDecrement: numeric(1, 1, "higher") },
	"core/remediation-step-size": {
		maxFiles: numeric(10, 20, "lower"),
		maxChangedLines: numeric(300, 600, "lower"),
	},
	"core/max-file-bytes": { maxBytes: numeric(1048576, 5242880, "lower") },
	"core/arch-module-size": {
		maxFiles: numeric(80, 150, "lower"),
		maxLines: numeric(8000, 15000, "lower"),
	},
	"core/loop-breaker": { maxRepeats: numeric(3, 5, "lower") },
	"core/review-round-cap": { maxRounds: numeric(3, 5, "lower") },
	"core/doc-placement": { allowedGlobs: stringSet([], "subset") },
	"core/doc-size": {
		maxBytes: numeric(40000, 60000, "lower"),
		maxLines: numeric(500, 800, "lower"),
	},
	"core/doc-breadth": {
		maxH2: numeric(15, 25, "lower"),
		maxFilesPerFolder: numeric(40, 60, "lower"),
	},
	"core/doc-density": {
		maxSentenceWords: numeric(40, 55, "lower"),
		maxParagraphSentences: numeric(6, 9, "lower"),
	},
	"core/agent-assets-present": {
		requiredHelpers: stringSet(["knowledge-graph", "token-saver"], "superset"),
	},
};

// SPEC §5.1–§5.12: every rule the tables mark floor. A floor rule id under
// tunables or in a waiver is CDX-E103 (§4.2.2).
export const FLOOR_RULES: ReadonlySet<string> = new Set([
	"core/read-dedupe",
	"core/graph-before-scan",
	"core/mcp-declared",
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
	"core/spec-trace",
	"core/red-before-green",
	"core/test-kinds-by-scenario",
	"core/regression-test-for-fix",
	"core/no-assertion-loss",
	"core/no-skipped-tests",
	"core/no-new-suppressions",
	"core/no-fixture-shrink",
	"core/no-threshold-lowering",
	"core/test-command-intact",
	"core/no-baseline-raise",
	"core/dead-code",
	"core/no-speculative-abstraction",
	"core/no-guard-removal",
	"core/arch-profile-declared",
	"core/arch-module-mapped",
	"core/arch-boundaries",
	"core/arch-public-entry",
	"core/arch-no-cycles",
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
	"core/conventional-commit",
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
