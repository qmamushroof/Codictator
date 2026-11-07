// SPEC §4.13: remediation plan, next step, single-step run and status.
// The plan generates from the baseline through the owning planner;
// single steps run behind their gate evidence (CDX-E608 without it).

import {
	type Baseline,
	planRemediation,
	type RemediationPlan,
	runStep,
} from "../features/remediation/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok, parseJson, stableStringify } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	needRoot,
	printHuman,
	printJson,
	readStateText,
	usageError,
	writeStateText,
} from "./shared.ts";

// SPEC §7.1: the remediation plan lives at
// .codictator/plan/remediation.json. The pre-SPEC path is read once as a
// migration, then the SPEC path owns it.
export const REMEDIATION_PLAN_PATH = ".codictator/plan/remediation.json";

const LEGACY_REMEDIATION_PLAN_PATH = ".codictator/remediation-plan.json";

function toBaseline(value: unknown): Baseline {
	const fallback: Baseline = { version: 1, entries: {} };
	if (typeof value !== "object" || value === null) {
		return fallback;
	}
	const entries = (value as { entries?: unknown }).entries;
	if (typeof entries !== "object" || entries === null) {
		return fallback;
	}
	return { version: 1, entries: entries as Baseline["entries"] };
}

function toPlan(value: unknown): RemediationPlan | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const steps = (value as { steps?: unknown }).steps;
	if (!Array.isArray(steps)) {
		return undefined;
	}
	return value as RemediationPlan;
}

// SPEC §7.1 D10: read the SPEC path, else the legacy path once. A
// migrated legacy plan is written to the SPEC path best-effort, so the
// next read never touches the old path again. Missing reads undefined;
// present-but-not-a-plan reads null, so callers keep both errors.
export async function readRemediationPlan(
	root: string,
): Promise<RemediationPlan | null | undefined> {
	const fresh = await readStateText(root, REMEDIATION_PLAN_PATH);
	if (fresh !== undefined) {
		const parsed = parseJson(fresh);
		return parsed.ok ? (toPlan(parsed.value) ?? null) : null;
	}
	const legacy = await readStateText(root, LEGACY_REMEDIATION_PLAN_PATH);
	if (legacy === undefined) {
		return undefined;
	}
	const parsed = parseJson(legacy);
	const shaped = parsed.ok ? toPlan(parsed.value) : undefined;
	if (shaped === undefined) {
		return null;
	}
	await writeStateText(
		root,
		REMEDIATION_PLAN_PATH,
		`${stableStringify(shaped)}\n`,
	);
	return shaped;
}

async function remediatePlan(
	req: CommandRequest,
	root: string,
): Promise<Result<number>> {
	if (req.args.length !== 1) {
		return usageError("usage: codictator remediate plan");
	}
	const baselineText = await readStateText(root, ".codictator/baseline.json");
	const parsedBaseline =
		baselineText === undefined ? undefined : parseJson(baselineText);
	const baseline: Baseline =
		parsedBaseline?.ok === true
			? toBaseline(parsedBaseline.value)
			: { version: 1, entries: {} };
	const planned = await planRemediation(baseline, []);
	if (!planned.ok) {
		return fail(
			"CDX-E903",
			planned.error.message,
			planned.error.remediation,
			req.json,
		);
	}
	const saved = await writeStateText(
		root,
		REMEDIATION_PLAN_PATH,
		`${stableStringify(planned.value)}\n`,
	);
	if (!saved.ok) {
		return fail(
			"CDX-E903",
			saved.error.message,
			saved.error.remediation,
			req.json,
		);
	}
	printHuman(`planned ${planned.value.steps.length} step(s)`, req.quiet);
	return ok(0);
}

function remediateStatus(
	plan: RemediationPlan,
	req: CommandRequest,
): Result<number> {
	const done = plan.steps.filter((step) => step.status === "done").length;
	if (req.json) {
		printJson({ done, total: plan.steps.length });
	} else {
		printHuman(
			`remediation progress: ${done}/${plan.steps.length} done`,
			req.quiet,
		);
	}
	return ok(0);
}

function remediateNext(
	plan: RemediationPlan,
	req: CommandRequest,
): Result<number> {
	const next = plan.steps.find((step) => step.status !== "done");
	if (next === undefined) {
		printHuman("remediation plan complete", req.quiet);
		return ok(0);
	}
	printHuman(`next step: ${String(next.id ?? "unknown")}`, req.quiet);
	return ok(0);
}

async function remediateRun(
	plan: RemediationPlan,
	req: CommandRequest,
): Promise<Result<number>> {
	const id = req.args[1] ?? "";
	if (id === "" || req.args.length !== 2) {
		return usageError("usage: codictator remediate run <id>");
	}
	const ran = await runStep(plan, id);
	if (!ran.ok) {
		return fail(
			ran.error.code,
			ran.error.message,
			ran.error.remediation,
			req.json,
		);
	}
	printHuman(
		`ran step ${id}: gate evidence required before completion`,
		req.quiet,
	);
	return ok(1);
}

export async function handleRemediate(
	req: CommandRequest,
): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "plan" && sub !== "next" && sub !== "run" && sub !== "status") {
		return usageError(
			"usage: codictator remediate <plan|next|run <id>|status>",
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	if (sub === "plan") {
		return remediatePlan(req, root);
	}
	const planText = await readRemediationPlan(root);
	if (planText === undefined) {
		return fail(
			"CDX-E903",
			"no remediation plan",
			"Run codictator remediate plan first, then retry.",
			req.json,
		);
	}
	if (planText === null) {
		return fail(
			"CDX-E903",
			"remediation plan is not a plan",
			"Rerun codictator remediate plan, then retry.",
			req.json,
		);
	}
	const shaped = planText;
	if (sub === "status") {
		return remediateStatus(shaped, req);
	}
	if (sub === "next") {
		return remediateNext(shaped, req);
	}
	return remediateRun(shaped, req);
}
