// Slice 0 meta-guard table and finding extraction for the consumer
// conformance suite. Lives here (not in the test files, and apart from the
// repo-setup harness) so every consumer file stays under the core/file-size
// cap that covers tests.
import { parseJson } from "../../src/kernel/index.ts";

// Slice 0 meta-guard table: [ruleId, probe, gap]. Probe keys are executed
// once each; results cached.
export const MATRIX: ReadonlyArray<readonly [string, string, string]> = [
	["core/mcp-declared", "session", "G3"],
	["core/guardrail-manifest", "session", "G3"],
	["core/hooks-active", "session", "G3"],
	["core/engine-version-match", "session", "G3"],
	["core/workflow-gates", "write-notask", "G1"],
	["core/writes-within-plan", "write-narrow", "G1"],
	["core/red-before-green", "write-preproof", "G1"],
	["core/arch-module-mapped", "write-preproof", "G2"],
	["core/arch-boundaries", "write-preproof", "G2"],
	["core/arch-public-entry", "write-preproof", "G2"],
	["core/arch-no-cycles", "write-preproof", "G2"],
	["core/no-secrets", "write-secret", "G2"],
	["core/write-confinement", "write-outside", "G2"],
	["core/dangerous-shell", "shell-danger", "G2"],
	["core/no-secret-reads", "read-secret", "G2"],
	["core/read-dedupe", "read-twice", "G2"],
	["core/graph-before-scan", "glob-broad", "G2"],
	["core/history-append-only", "write-history-edit", "G2"],
	["core/bug-rows-immutable", "write-bugs-edit", "G2"],
	["core/diagnose-before-fix", "write-fix-nodiag", "G1"],
	["core/dep-exact-pin", "write-package", "G2"],
	["core/dep-one-per-capability", "write-package", "G2"],
	["core/no-guard-removal", "verify-tdd-range", "G6"],
	["core/ci-actions-pinned", "write-workflow", "G2"],
	["core/file-naming", "write-badname", "G2"],
	["core/no-bypass", "shell-bypass", "G2"],
	["core/conventional-commit", "msg-badsubject", "G5"],
	["core/arch-profile-declared", "verify-tdd-range", "G6"],
	["core/repo-hygiene", "stage-planning", "G5"],
	["core/doc-one-level", "stage-docs", "G5"],
	["core/doc-router-leaf", "stage-docs", "G5"],
	["core/doc-links-valid", "stage-docs", "G5"],
	["core/doc-no-inline-changelog", "stage-docs", "G5"],
	["core/doc-no-corpus-counts", "stage-docs", "G5"],
	["core/doc-single-owner", "stage-docs", "G5"],
	["core/dep-no-vulnerable", "stage-deps", "G5"],
	["core/dep-no-deprecated", "stage-deps", "G5"],
	["core/dep-new-needs-reason", "stage-deps", "G5"],
	["core/dep-lockfile", "stage-deps", "G5"],
	["core/history-entry-complete", "stage-history", "G5"],
	["core/history-entry", "verify-norange-history", "G6"],
	["core/no-assertion-loss", "verify-tdd-range", "G6"],
	["core/no-skipped-tests", "verify-tdd-range", "G6"],
	["core/no-new-suppressions", "verify-tdd-range", "G6"],
	["core/no-fixture-shrink", "verify-tdd-range", "G6"],
	["core/no-threshold-lowering", "verify-tdd-range", "G6"],
	["core/test-command-intact", "verify-tdd-range", "G6"],
	["core/test-kinds-by-scenario", "verify-tdd-range", "G6"],
	["core/regression-test-for-fix", "verify-tdd-range", "G6"],
	["core/no-baseline-raise", "verify-tdd-range", "G6"],
	["core/no-speculative-abstraction", "verify-tdd-range", "G6"],
	["core/review-gate", "verify-tdd-range", "G6"],
	["core/bug-registry", "verify-tdd-range", "G6"],
	["core/compiler-strict", "verify-tdd-range", "G6"],
	["core/perf-budgets", "verify-tdd-range", "G6"],
	["core/branch-protection", "verify-tdd-range", "G6"],
	["core/ci-present", "verify-tdd-range", "G6"],
	["core/ci-required-check", "verify-tdd-range", "G6"],
	["core/waivers-valid", "verify-tdd-range", "G6"],
	["core/custom-pack-selftest", "verify-tdd-range", "G6"],
	["ts/no-phantom-import", "write-ts-phantom", "G2"],
	["ts/security-patterns", "write-ts-eval", "G2"],
	["ts/lint", "verify-tdd-range", "G6"],
	["ts/typecheck", "verify-tdd-range", "G6"],
	["python/no-phantom-import", "write-py-phantom", "G2"],
	["python/security-patterns", "write-py-eval", "G2"],
	["python/lint", "verify-tdd-range", "G6"],
	["python/typecheck", "verify-tdd-range", "G6"],
	["core/spec-trace", "bydesign", "BYDESIGN"],
	["core/dead-code", "bydesign", "BYDESIGN"],
];

// Finding ids from a `--json` CLI reply; empty when the reply is not JSON.
export function findingIds(stdout: string): Array<string> {
	const start = stdout.indexOf("{");
	if (start < 0) {
		return [];
	}
	const parsed = parseJson(stdout.slice(start));
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return [];
	}
	const { findings } = parsed.value as {
		findings?: Array<{ ruleId?: string }>;
	};
	if (!Array.isArray(findings)) {
		return [];
	}
	return findings
		.map((finding) => finding?.ruleId ?? "")
		.filter((id) => id !== "");
}

// Split literal so a committed test source never holds a live-pattern
// literal the repo's own L4 gate would flag (same idiom as l34).
export const VECTOR = ["sk-dogfood-rejected-", "0123456789abcdef"].join("");
