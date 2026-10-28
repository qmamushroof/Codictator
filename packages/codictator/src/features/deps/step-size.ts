// SPEC §5.6 core/remediation-step-size and the §4.13.4 post gate: a step
// stays within maxFiles files and maxChangedLines changed lines. This pure
// check is the shared implementation; the enforcer registry wiring that
// executes the §5.6 fixtures lands with gate-closure (D3).
import type { Finding } from "../engine/index.ts";

export interface StepSizeParams {
	readonly maxFiles: number;
	readonly maxChangedLines: number;
}

// SPEC §5.6 defaults: 10 files, 300 lines (bound 20 and 600).
export const DEFAULT_STEP_SIZE: StepSizeParams = {
	maxFiles: 10,
	maxChangedLines: 300,
};

function sizeFinding(
	path: string,
	count: number,
	limit: number,
	unit: string,
): Finding {
	return {
		ruleId: "core/remediation-step-size",
		path,
		message: `remediation step touches ${count} ${unit}, above the ${limit} ${unit} budget`,
		remediation: `Split the step touching ${path} below ${limit}.`,
	};
}

// Files first, then lines, so repeated runs observe the same order (§10.3).
export function checkRemediationStepSize(
	filesChanged: number,
	changedLines: number,
	path: string,
	params: StepSizeParams = DEFAULT_STEP_SIZE,
): Array<Finding> {
	const findings: Array<Finding> = [];
	if (filesChanged > params.maxFiles) {
		findings.push(sizeFinding(path, filesChanged, params.maxFiles, "files"));
	}
	if (changedLines > params.maxChangedLines) {
		findings.push(
			sizeFinding(path, changedLines, params.maxChangedLines, "lines"),
		);
	}
	return findings;
}
