// SPEC §4.15: CI workflow generation and CI checks. The tested contracts
// stay on this entry; helpers live beside it (SPEC §3.3).
import type { CheckContext, Finding } from "../engine/index.ts";
import {
	type BotChangeInput,
	externalCiStatus,
	planSweep,
	qualifyBotChange,
	type SweepInput,
} from "./changes.ts";
import {
	type BaseRefInput,
	checkActionsPinned,
	evaluateProtection,
	type PinnedUse,
	type ProtectionRead,
	resolveBaseRef,
} from "./protection.ts";
import {
	type CiWorkflow,
	FALLBACK_PINS,
	type RenderWorkflowOptions,
	renderWorkflow as renderWorkflowImpl,
	scheduleCronFor,
	type WorkflowPins,
} from "./workflow.ts";

export type {
	BaseRefInput,
	BotChangeInput,
	CiWorkflow,
	PinnedUse,
	ProtectionRead,
	RenderWorkflowOptions,
	SweepInput,
	WorkflowPins,
};
export {
	checkActionsPinned,
	evaluateProtection,
	externalCiStatus,
	FALLBACK_PINS,
	planSweep,
	qualifyBotChange,
	resolveBaseRef,
	scheduleCronFor,
};

export interface CiEvidence {
	// SPEC §4.15.7 EC-2: unknown base reachability fails closed (CDX-E503).
	readonly baseReachable?: boolean;
	readonly forkPr?: boolean;
	// SPEC §4.15.2: unreadable protection reads advise, never allow.
	readonly protection?: ProtectionRead;
	// SPEC §4.15.2: absent uses default to the unpinned generated steps.
	readonly unpinnedUses?: ReadonlyArray<PinnedUse>;
	readonly workflowDrifted?: boolean;
	readonly botChange?: BotChangeInput;
	readonly sweep?: SweepInput;
	readonly external?: {
		readonly host: "github" | "external";
		readonly confirmed: boolean;
	};
}

// SPEC §4.15.1: generated workflow rendering.
export function renderWorkflow(
	repoRoot: string,
	options?: RenderWorkflowOptions,
): CiWorkflow {
	return renderWorkflowImpl(repoRoot, options);
}

function unreachableBase(): Finding {
	return {
		ruleId: "core/ci-present",
		code: "CDX-E503",
		message: "CI base commit reachability is unconfirmed: blocking fail-closed",
		remediation:
			"Fetch with fetch-depth 0 so the base is reachable, then rerun (EC-2).",
	};
}

// SPEC §4.15.2: CI-side checks (required checks present, no bypass).
// Defaults fail closed: unknown base → CDX-E503, unreadable protection →
// advise, unpinned steps → core/ci-actions-pinned.
export function checkCi(
	_ctx: CheckContext,
	workflow: CiWorkflow,
	evidence?: CiEvidence,
): Array<Finding> {
	const findings: Array<Finding> = [];
	if (evidence?.baseReachable !== true) {
		findings.push(unreachableBase());
	}
	findings.push(...evaluateProtection(evidence?.protection));
	if (evidence?.unpinnedUses !== undefined) {
		findings.push(...checkActionsPinned(evidence.unpinnedUses));
	} else if (workflow.host === "github") {
		findings.push(
			...checkActionsPinned([
				{ file: ".github/workflows/codictator.yml", uses: "actions/checkout" },
			]),
		);
	}
	if (evidence?.workflowDrifted === true) {
		findings.push({
			ruleId: "core/guardrail-manifest",
			message:
				"CI workflow differs from its manifest entry (for example continue-on-error added)",
			remediation: "Restore the workflow with `codictator regen` (EC-4).",
		});
	}
	if (evidence?.botChange !== undefined) {
		findings.push(...qualifyBotChange(evidence.botChange).findings);
	} else if (evidence?.forkPr === true) {
		findings.push({
			ruleId: "core/ci-required-check",
			message:
				"PR from a fork with a read-only token: verify runs, protection reads only advise",
			remediation:
				"Confirm the required check on the merge commit by hand (EC-1).",
		});
	}
	if (evidence?.sweep !== undefined) {
		findings.push(...planSweep(evidence.sweep).findings);
	}
	if (evidence?.external !== undefined) {
		findings.push(...externalCiStatus(evidence.external));
	}
	return findings;
}
