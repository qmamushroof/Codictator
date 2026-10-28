// SPEC §4.13.4 and §4.13.7–§4.13.8: single-step execution behind its
// gates, mechanical rollback and split, and the L4 pre-existing-findings
// rule. Gate evidence arrives from the caller (the CLI observes the tree,
// the suites and the diff through its ports); without evidence the step
// fails closed instead of running blind (PRD §12 #12).

import type { CdxError, Result } from "../../kernel/index.ts";
import { makeError } from "../../kernel/index.ts";
import { checkRemediationStepSize } from "../deps/index.ts";
import type { Finding } from "../engine/index.ts";
import type { RemediationPlan, RemediationStep } from "./types.ts";

export interface StepGateEvidence {
	readonly cleanTree: boolean;
	readonly baseGreen: boolean;
	readonly postGreen: boolean;
	readonly newFindings: ReadonlyArray<Finding>;
	readonly targetsMet: boolean;
	readonly ratchetClean: boolean;
	readonly filesChanged: number;
	readonly changedLines: number;
	readonly branch: string;
	readonly rollbackRequested?: boolean | undefined;
}

function gateFailure(message: string): CdxError {
	return makeError(
		"CDX-E604",
		message,
		"Fix the gate output, then split the step before retrying (SPEC §4.13.7).",
	);
}

function truncateGateOutput(output: string): string {
	return output.length > 4000 ? output.slice(0, 4000) : output;
}

// SPEC §4.13.7: only Codictator's own codictator/remediate/* branches are
// ever reset and deleted; a user branch or the default branch is refused.
export function isStepBranch(branch: string): boolean {
	return branch.startsWith("codictator/remediate/");
}

export function refuseRollback(branch: string): Result<void> {
	if (isStepBranch(branch)) {
		return { ok: true, value: undefined };
	}
	return {
		ok: false,
		error: makeError(
			"CDX-E609",
			`rollback refused on ${branch}: only codictator/remediate/* branches roll back`,
			"Roll back from the step branch, or reset the user branch by hand.",
		),
	};
}

function failStep(message: string): Result<RemediationStep> {
	return {
		ok: false,
		error: gateFailure(truncateGateOutput(message)),
	};
}

// SPEC §4.13.4: pre gates (clean tree, green base) run before anything;
// post gates (green suites, no new findings, target deltas, no ratchet
// rise, size budget) decide done. Every failure becomes failed with
// attempts + 1; the caller splits or blocks from there (§4.13.7).
export function runStep(
	plan: RemediationPlan,
	stepId: string,
	evidence?: StepGateEvidence | undefined,
): Promise<Result<RemediationStep>> {
	const step = plan.steps.find((candidate) => candidate.id === stepId);
	if (step === undefined) {
		throw new Error(`unknown remediation step ${stepId}`);
	}
	if (step.status === "done") {
		return Promise.resolve({ ok: true, value: step });
	}
	if (evidence === undefined || !evidence.cleanTree) {
		return Promise.resolve({
			ok: false,
			error: makeError(
				"CDX-E608",
				"remediation needs a clean work tree",
				"Commit or stash the work tree, then rerun the step.",
			),
		});
	}
	if (evidence.rollbackRequested === true) {
		const allowed = refuseRollback(evidence.branch);
		if (!allowed.ok) {
			return Promise.resolve({ ok: false, error: allowed.error });
		}
	}
	if (!evidence.baseGreen) {
		return Promise.resolve(
			failStep(`pre gate: build, suite or smoke fails on the ${step.id} base`),
		);
	}
	if (!evidence.postGreen) {
		return Promise.resolve(
			failStep(
				`post gate: suites or smoke fail after ${step.id}; step rolled back`,
			),
		);
	}
	if (evidence.newFindings.length > 0) {
		const names = evidence.newFindings
			.map((finding) => finding.ruleId)
			.sort()
			.join(", ");
		return Promise.resolve(
			failStep(
				`post gate: ${step.id} introduces findings outside its scope: ${names}`,
			),
		);
	}
	if (!evidence.targetsMet) {
		return Promise.resolve(
			failStep(
				`post gate: ${step.id} target keys did not fall by their expectedDelta`,
			),
		);
	}
	if (!evidence.ratchetClean) {
		return Promise.resolve(
			failStep(`post gate: a ratchet key rose under ${step.id}`),
		);
	}
	const oversize = checkRemediationStepSize(
		evidence.filesChanged,
		evidence.changedLines,
		step.scope[0] ?? step.id,
	);
	if (oversize.length > 0) {
		return Promise.resolve(
			failStep(
				`post gate: ${oversize.map((finding) => finding.message).join("; ")}`,
			),
		);
	}
	return Promise.resolve({ ok: true, value: { ...step, status: "done" } });
}

export interface SplitDetail {
	readonly packages?: ReadonlyArray<string> | undefined;
	readonly modules?: ReadonlyArray<string> | undefined;
	readonly batchFiles?: number | undefined;
	readonly regions?: ReadonlyArray<string> | undefined;
}

export interface SplitOutcome {
	readonly children: ReadonlyArray<Omit<RemediationStep, "id">>;
	readonly blocked: boolean;
}

function childBase(
	kind: string,
	scope: ReadonlyArray<string>,
	executor: string,
): Omit<RemediationStep, "id"> {
	return {
		kind,
		scope: [...scope],
		executor,
		dependsOn: [],
		status: "pending",
		attempts: 0,
		target: [],
		sizeBudget: { files: 10, lines: 300 },
		expectedDelta: 1,
		children: [],
	};
}

// SPEC §4.13.7 split table. An unsplittable step, or one failing twice at
// minimal size, becomes blocked and escalates to the human (§4.12.5).
export function splitRemediationStep(
	step: RemediationStep,
	detail: SplitDetail = {},
): SplitOutcome {
	switch (step.kind) {
		case "dep-update": {
			const packages = detail.packages ?? [];
			if (packages.length > 1) {
				return {
					children: packages.map((name) =>
						childBase("dep-update", [name], "codictator"),
					),
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		case "dep-major": {
			const packages = detail.packages ?? [];
			if (packages.length > 1) {
				return {
					children: packages.map((name) =>
						childBase("dep-major", [name], "agent"),
					),
					blocked: false,
				};
			}
			const modules = detail.modules ?? [];
			if (modules.length > 1) {
				return {
					children: modules.map((name) =>
						childBase("dep-major", [name], "agent"),
					),
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		case "arch-move": {
			const batch = detail.batchFiles ?? 10;
			const half = Math.max(1, Math.floor(batch / 2));
			if (step.scope.length > half) {
				const midpoint = Math.ceil(step.scope.length / 2);
				return {
					children: [
						childBase("arch-move", step.scope.slice(0, midpoint), "agent"),
						childBase("arch-move", step.scope.slice(midpoint), "agent"),
					],
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		case "debt-reduce":
		case "docs": {
			const regions = detail.regions ?? [];
			if (regions.length > 0) {
				return {
					children: regions.map((region) =>
						childBase(
							step.kind,
							[`${step.scope[0] ?? "repo"}#${region}`],
							"agent",
						),
					),
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		default:
			return { children: [], blocked: true };
	}
}

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
