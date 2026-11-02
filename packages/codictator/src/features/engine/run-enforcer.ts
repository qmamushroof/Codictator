// SPEC §4.3.8 fail closed: an enforcer that throws, exceeds its budget, or
// lacks data yields a synthetic finding and the verdict blocks. Sorted
// enforcer and finding order keeps the verdict a pure function of its
// inputs (SPEC §4.3.6).
import type { CheckContext, Enforcer, Finding } from "./index.ts";

function failFinding(
	enforcerId: string,
	code: "CDX-E801" | "CDX-E901" | "CDX-E902" | "CDX-E903",
	detail: string,
	remediation: string,
): Finding {
	return {
		ruleId: enforcerId,
		code,
		message: `the guard "${enforcerId}" ${detail}; the code was not judged`,
		remediation,
	};
}

// SPEC §4.3.8: a throw is CDX-E901, unless the enforcer threw its CdxError
// for unavailable data, which is CDX-E903.
function thrownCode(error: unknown): "CDX-E901" | "CDX-E903" {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code: unknown = error.code;
		if (code === "CDX-E903") {
			return "CDX-E903";
		}
	}
	return "CDX-E901";
}

const TIMED_OUT = { timedOut: true };

function withBudget(
	pending: Promise<Array<Finding>>,
	budgetMs: number,
): Promise<Array<Finding>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Array<Finding>>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(TIMED_OUT);
		}, budgetMs);
	});
	return Promise.race([pending, timeout]).finally(() => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	});
}

export async function runEnforcer(
	enforcer: Enforcer,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	let pending: Promise<Array<Finding>>;
	try {
		// Rule params arrive with the pack registry (phase 5); E2 runs
		// enforcers with an empty param set.
		pending = enforcer.check(ctx, {});
	} catch (error) {
		return [
			failFinding(
				enforcer.id,
				thrownCode(error),
				"failed with CDX-E901",
				"Fix the guard or retry the hook, then run codictator verify.",
			),
		];
	}
	try {
		return await withBudget(pending, enforcer.budgetMs);
	} catch (error) {
		if (error === TIMED_OUT) {
			return [
				failFinding(
					enforcer.id,
					"CDX-E902",
					`exceeded its ${enforcer.budgetMs} ms budget (CDX-E902)`,
					"Give the guard a larger budget or a smaller scope, then retry.",
				),
			];
		}
		return [
			failFinding(
				enforcer.id,
				thrownCode(error),
				"failed with CDX-E901",
				"Fix the guard or retry the hook, then run codictator verify.",
			),
		];
	}
}

export function sortFindings(findings: Array<Finding>): Array<Finding> {
	return [...findings].sort(compareFindings);
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareFindingPaths(a: Finding, b: Finding): number {
	return compareText(a.path ?? "", b.path ?? "");
}

function compareFindingContent(a: Finding, b: Finding): number {
	if ((a.line ?? 0) !== (b.line ?? 0)) {
		return (a.line ?? 0) - (b.line ?? 0);
	}
	return compareText(a.message, b.message);
}

function compareFindings(a: Finding, b: Finding): number {
	return (
		compareText(a.ruleId, b.ruleId) ||
		compareFindingPaths(a, b) ||
		compareFindingContent(a, b)
	);
}

export function appendFailedFinding(): Finding {
	return failFinding(
		"core/engine",
		"CDX-E801",
		"could not record its verdict event (CDX-E801)",
		"Free disk space and fix permissions on .codictator/state/, then retry.",
	);
}
