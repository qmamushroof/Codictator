// SPEC §4.15: CI workflow generation and CI checks.
import type { CheckContext, Finding } from "../engine/index.ts";

export interface CiWorkflow {
	readonly host: "github" | "external";
	readonly os: ReadonlyArray<string>;
	readonly steps: ReadonlyArray<string>;
}

// SPEC §4.15.1: generated workflow rendering.
export function renderWorkflow(_repoRoot: string): Promise<CiWorkflow> {
	throw new Error("not implemented: SPEC §4.15.1");
}

// SPEC §4.15.2: CI-side checks (required checks present, no bypass).
export function checkCi(
	_ctx: CheckContext,
	_workflow: CiWorkflow,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.15.2");
}
