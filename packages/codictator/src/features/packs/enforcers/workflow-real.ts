// SPEC §5.9 real-scope judging for workflow/review: gate, plan, and round
// caps over the claiming task records. Guards in workflow-guards.ts handle
// marker fixtures; this module never touches them.
import type { Ports } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import type { RuleBinding } from "./binding.ts";
import { findingFor } from "./binding.ts";
import { checkPhaseGate, MANDATORY_PHASES } from "../../workflow/phases.ts";
import { checkWriteWithinPlan, classifyChange } from "../../workflow/writes.ts";
import { collectTaskFindings } from "./scope-tasks.ts";

export function nextPhaseOf(phase: string): string | undefined {
	const at = MANDATORY_PHASES.indexOf(phase);
	if (at < 0 || at + 1 >= MANDATORY_PHASES.length) {
		return undefined;
	}
	return MANDATORY_PHASES[at + 1];
}

export async function workflowGatesReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	return collectTaskFindings(ports, files, async (task, findings) => {
		const next = nextPhaseOf(task.phase);
		if (next === undefined) {
			return;
		}
		for (const finding of await checkPhaseGate(task, next)) {
			if (finding.ruleId === "core/workflow-gates") {
				findings.push(finding);
			}
		}
	});
}

export async function writesWithinPlanReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	const changeClass = classifyChange(files);
	return collectTaskFindings(ports, files, async (task, findings) => {
		// SPEC §4.12.2: record exits on the staged history entry and
		// integrate on the commit itself, so a task past review with its
		// history staged has completed its plan — judging its landing
		// commit against implementation allow would block the workflow's
		// own final commit. The plan was judged at validation.
		if (
			(task.phase === "record" || task.phase === "integrate") &&
			task.historyStaged === true
		) {
			return;
		}
		for (const finding of await checkWriteWithinPlan(task, files, task.phase, {
			changeClass,
		})) {
			if (finding.ruleId === "core/writes-within-plan") {
				findings.push(finding);
			}
		}
	});
}

export async function reviewGateReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	return collectTaskFindings(ports, files, async (task, findings) => {
		if (task.phase !== "review") {
			return;
		}
		for (const finding of await checkPhaseGate(task, task.phase)) {
			if (finding.ruleId === "core/review-gate") {
				findings.push(finding);
			}
		}
	});
}

export async function reviewRoundCapReal(
	ports: Ports,
	binding: RuleBinding,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
	maxRounds: number,
): Promise<void> {
	const extra = await collectTaskFindings(ports, files, (task, out) => {
		const rounds = task.reviews?.length ?? 0;
		if (rounds <= maxRounds) {
			return;
		}
		const path = files[0] ?? `(task ${task.id})`;
		out.push(
			findingFor(binding, {
				path,
				message: `review past ${String(maxRounds)} rounds on ${task.id}`,
				vars: { path, limit: String(maxRounds) },
			}),
		);
	});
	findings.push(...extra);
}
