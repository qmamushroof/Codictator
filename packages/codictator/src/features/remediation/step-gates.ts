// SPEC §4.13.4: single-step execution behind its gates. Gate evidence
// arrives from the caller (the CLI observes the tree, the suites and the
// diff through its ports); without evidence the step fails closed instead
// of running blind (PRD §12 #12).
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
