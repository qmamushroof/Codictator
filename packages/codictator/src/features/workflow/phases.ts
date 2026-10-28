// SPEC §4.12.2–§4.12.3: phases, change classes, custom phases and L1 write
// gating. checkPhaseGate evaluates the gate; checkWriteWithinPlan judges a
// single write. Both return findings, never throws.
import type { Finding } from "../engine/index.ts";
import type { TaskRecord } from "./tasks.ts";

// SPEC §4.12.2: the seven mandatory phases in order.
export const MANDATORY_PHASES: ReadonlyArray<string> = [
	"discovery",
	"planning",
	"implementation",
	"validation",
	"review",
	"record",
	"integrate",
];

export function isMandatoryPhase(value: string): boolean {
	return MANDATORY_PHASES.includes(value);
}

function customPhasesOf(task: TaskRecord): ReadonlyArray<string> {
	return task.customPhases ?? [];
}

function isKnownPhase(task: TaskRecord, phase: string): boolean {
	return isMandatoryPhase(phase) || customPhasesOf(task).includes(phase);
}

// SPEC §4.12.2: the mandatory phases keep their relative order; removing
// or reordering one is CDX-E105, as is inserting a custom phase before
// discovery.
export function validatePhaseOrder(order: ReadonlyArray<string>): boolean {
	let cursor = -1;
	for (const mandatory of MANDATORY_PHASES) {
		const at = order.indexOf(mandatory);
		if (at < 0 || at <= cursor) {
			return false;
		}
		cursor = at;
	}
	return true;
}

export interface PhaseGateDetail {
	readonly openTasks?: ReadonlyArray<string>;
	readonly phaseOrder?: ReadonlyArray<string>;
}

function e105UnknownPhase(phase: string): Finding {
	return {
		ruleId: "core/workflow-gates",
		code: "CDX-E105",
		message: `unknown phase "${phase}"; the seven mandatory phases keep their order`,
		remediation:
			"Declare the phase in config.workflow.phases after discovery, then re-run the gate.",
	};
}

function e105PhaseOrder(): Finding {
	return {
		ruleId: "core/workflow-gates",
		code: "CDX-E105",
		message:
			"mandatory workflow phases removed or reordered; custom phases insert after discovery only",
		remediation:
			"Restore the seven mandatory phases in order with custom phases after discovery.",
	};
}

function e606TwoTasks(open: ReadonlyArray<string>, task: TaskRecord): Finding {
	const listed =
		open.length > 0 ? open.join(", ") : `${task.id} and a second opener`;
	return {
		ruleId: "core/workflow-gates",
		code: "CDX-E606",
		message: `more than one open task on branch "${task.branch}": ${listed}`,
		remediation:
			"Run codictator task status, close or merge the extra task, then retry.",
	};
}

// SPEC §4.12.2 exit gates: the evidence each phase owes before the next
// phase opens. Implementation and integrate owe no exit evidence.
function missingExitEvidence(task: TaskRecord, phase: string): Array<string> {
	switch (phase) {
		case "discovery": {
			const missing: Array<string> = [];
			if (task.spec.length === 0) {
				missing.push("spec refs");
			}
			if (task.type === "fix" && (task.diagnosis ?? "").length === 0) {
				missing.push("diagnosis");
			}
			return missing;
		}
		case "planning": {
			const missing: Array<string> = [];
			if (task.files.allow.length === 0) {
				missing.push("files.allow globs");
			}
			if (task.acceptanceCriteria.length === 0) {
				missing.push("acceptance criteria");
			}
			if ((task.tests ?? []).length === 0) {
				missing.push("declared tests");
			}
			if (task.redProof === undefined) {
				missing.push("red proof");
			}
			return missing;
		}
		case "validation": {
			return task.greenProof === undefined ? ["green proof"] : [];
		}
		case "review": {
			return missingReviewEvidence(task);
		}
		case "record": {
			const missing: Array<string> = [];
			if (task.historyStaged !== true) {
				missing.push("staged history entry");
			}
			if (task.type === "fix" && task.bugRowUpdated !== true) {
				missing.push("bug row update");
			}
			return missing;
		}
		default: {
			return [];
		}
	}
}

function missingReviewEvidence(task: TaskRecord): Array<string> {
	const rounds = task.reviews ?? [];
	if (rounds.length === 0) {
		return ["completed review round"];
	}
	const last = rounds[rounds.length - 1];
	if (last === undefined) {
		return ["completed review round"];
	}
	const missing: Array<string> = [];
	if (last.openBlockers > 0 || last.openMajors > 0) {
		missing.push("zero open blocker/major findings");
	}
	const pending = (task.integrityExceptions ?? []).filter(
		(id) => !last.acknowledgedExceptions.includes(id),
	);
	if (pending.length > 0) {
		missing.push("acknowledged integrity exceptions");
	}
	return missing;
}

function e604MissingGate(
	task: TaskRecord,
	missing: ReadonlyArray<string>,
): Finding {
	return {
		ruleId: "core/workflow-gates",
		code: "CDX-E604",
		message: `phase gate evidence missing for ${task.phase}: ${missing.join(", ")}`,
		remediation: `Run codictator task phase next to list the missing evidence for ${task.phase}.`,
	};
}

// SPEC §4.12.2: advance only when the exit gate holds, else CDX-E604. A
// change that touches code files is reclassified as code and owes every
// gate; docs-only writes stay allowed but never waive code gates.
export async function checkPhaseGate(
	task: TaskRecord,
	phase: string,
	detail: PhaseGateDetail = {},
): Promise<Array<Finding>> {
	if (!isKnownPhase(task, phase)) {
		return [e105UnknownPhase(phase)];
	}
	if (
		detail.phaseOrder !== undefined &&
		!validatePhaseOrder(detail.phaseOrder)
	) {
		return [e105PhaseOrder()];
	}
	// SPEC §4.12.7 EC-10: re-entering planning while planning is already
	// active means a second writer opened planning on this branch. The
	// caller-provided open-task list decides whenever it is present.
	const open = detail.openTasks;
	if (open !== undefined && open.length >= 2) {
		return [e606TwoTasks(open, task)];
	}
	if (open === undefined && task.phase === "planning" && phase === "planning") {
		return [e606TwoTasks([], task)];
	}
	if (phase !== task.phase) {
		const missing = missingExitEvidence(task, task.phase);
		if (missing.length > 0) {
			return [e604MissingGate(task, missing)];
		}
		return [];
	}
	// Same-phase evaluation: implementation, validation and record writes
	// are judged by the L1 write gate, not here; review re-entry owes a
	// completed round before it can pass.
	if (task.phase === "review") {
		const missing = missingReviewEvidence(task);
		if (missing.length > 0) {
			return [
				{
					ruleId: "core/review-gate",
					message: `review gate unmet in phase review: ${missing.join(", ")}`,
					remediation:
						"Run codictator review submit with a fresh reviewer session.",
				},
			];
		}
	}
	return [];
}
