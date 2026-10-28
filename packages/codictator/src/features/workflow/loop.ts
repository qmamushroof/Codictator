// SPEC §4.12.5: the loop breaker. Consecutive blocks by the same rule
// with no intervening allow escalate; only a human ack clears it.
import type { CheckContext, Finding } from "../engine/index.ts";

export const DEFAULT_MAX_REPEATS = 3;

export function escalationMessage(ruleId: string, attempts: number): string {
	return (
		`escalation: ${ruleId} blocked ${String(attempts)} times with no intervening allow. ` +
		"Stop and give the human a summary of the rule, the attempts and the conflict."
	);
}

// SPEC §4.12.7 EC-7: the fourth consecutive block escalates, and every
// tool call for the task stays blocked until a human runs task ack.
// SPEC §4.12.7 EC-8: the ack itself is human-only, so the shell guard
// blocks agents there; this check returns no finding for low counts.
export async function checkLoop(
	ctx: CheckContext,
	attempts: number,
	maxRepeats: number = DEFAULT_MAX_REPEATS,
): Promise<Array<Finding>> {
	void ctx;
	if (attempts <= maxRepeats) {
		return [];
	}
	return [
		{
			ruleId: "core/loop-breaker",
			message: escalationMessage("core/loop-breaker", attempts),
			remediation:
				"Run codictator task ack <id> --note ... to clear the escalation; task ack is human-only.",
		},
	];
}

// SPEC §4.12.4 cap: reaching the review-round cap escalates through the
// same path; the floor never moves, only the attempt stops.
export async function checkReviewCap(
	completedRounds: number,
	maxRounds: number = 3,
): Promise<Array<Finding>> {
	if (completedRounds < maxRounds) {
		return [];
	}
	return [
		{
			ruleId: "core/review-round-cap",
			message: escalationMessage("core/review-round-cap", completedRounds),
			remediation:
				"Run codictator task ack <id> --note ... to clear the escalation; task ack is human-only.",
		},
	];
}
