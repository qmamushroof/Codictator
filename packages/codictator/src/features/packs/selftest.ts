// SPEC §4.4.4: self-test. Every rule runs its violating fixtures (each must
// yield a finding with the rule id) and its passing fixtures (none may).
// A fixture exceeding twice the enforcer budget fails CDX-E215; an
// enforcer that throws fails CDX-E901. Both fail closed with the pack
// inert, like the engine treats them (SPEC §4.3.8).
import type { Result } from "../../kernel/index.ts";
import { err, makeError, ok } from "../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../engine/index.ts";
import type { CaseKind, CaseSource } from "./case-file.ts";
import type { Pack, PackRule } from "./index.ts";
import { checkParam } from "./params.ts";
import { mismatch, prepareCase } from "./selftest-case.ts";

const TIMED_OUT = { timedOut: true };

function thrownError(ruleId: string, enforcerId: string): Result<never> {
	return err(
		makeError(
			"CDX-E901",
			`enforcer "${enforcerId}" threw during self-test of rule "${ruleId}"; the pack is inert`,
			"Fix the guard so it runs clean on every fixture, then re-run the pack self-test.",
		),
	);
}

// SPEC §4.4.4: every fixture run finishes inside twice the budget. The
// timeout race detects exactly that without a clock port.
function withBudget(
	pending: Promise<Array<Finding>>,
	budgetMs: number,
): Promise<Array<Finding>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Array<Finding>>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(TIMED_OUT);
		}, budgetMs * 2);
	});
	return Promise.race([pending, timeout]).finally(() => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	});
}

async function runCase(
	enforcer: Enforcer,
	rule: PackRule,
	name: string,
	context: CheckContext,
): Promise<Result<Array<Finding>>> {
	let pending: Promise<Array<Finding>>;
	try {
		pending = enforcer.check(context, {});
	} catch {
		return thrownError(rule.id, enforcer.id);
	}
	try {
		return ok(await withBudget(pending, enforcer.budgetMs));
	} catch (error) {
		if (error === TIMED_OUT) {
			return err(
				makeError(
					"CDX-E215",
					`rule "${rule.id}" fixture "${name}" exceeded twice its ${enforcer.budgetMs} ms budget`,
					"Give the enforcer a larger budgetMs in the pack manifest, then re-run the self-test.",
				),
			);
		}
		return thrownError(rule.id, enforcer.id);
	}
}

function checkRuleMetadata(rule: PackRule): Result<void> {
	if (rule.fixtures.violating.length === 0) {
		return err(
			makeError(
				"CDX-E211",
				`rule "${rule.id}" has no violating fixture`,
				"Add a violating fixture under fixtures/<rule-slug>/violating/, then re-run the self-test.",
			),
		);
	}
	if (rule.remediation.length === 0 || rule.remediation === rule.reason) {
		return err(
			makeError(
				"CDX-E214",
				`rule "${rule.id}" remediation is empty or repeats its reason`,
				"Write remediation as Do-instead text distinct from Why, then re-run the self-test.",
			),
		);
	}
	for (const name of Object.keys(rule.params)) {
		const checked = checkParam(rule.id, name, rule.params[name]);
		if (!checked.ok) {
			return err(checked.error);
		}
	}
	return ok(undefined);
}

async function checkFixtures(
	pack: Pack,
	rule: PackRule,
	kind: CaseKind,
	source: CaseSource | undefined,
): Promise<Result<void>> {
	for (const name of rule.fixtures[kind]) {
		const prepared = await prepareCase(pack, rule, kind, name, source);
		if (!prepared.ok) {
			return err(prepared.error);
		}
		const ran = await runCase(
			prepared.value.enforcer,
			rule,
			name,
			prepared.value.context,
		);
		if (!ran.ok) {
			return err(ran.error);
		}
		const judged = mismatch(
			rule,
			kind,
			name,
			prepared.value,
			ran.value.map((finding) => finding.ruleId),
		);
		if (!judged.ok) {
			return err(judged.error);
		}
	}
	return ok(undefined);
}

async function selfTestRule(
	pack: Pack,
	rule: PackRule,
	source: CaseSource | undefined,
): Promise<Result<void>> {
	const metadata = checkRuleMetadata(rule);
	if (!metadata.ok) {
		return err(metadata.error);
	}
	const violating = await checkFixtures(pack, rule, "violating", source);
	if (!violating.ok) {
		return err(violating.error);
	}
	return checkFixtures(pack, rule, "passing", source);
}

// SPEC §4.4.4: self-test every rule against its fixtures before use. Rules
// run in id order so the first failure is deterministic. `source` names the
// pack directory whose fixtures/ tree holds the case files (§4.4.1).
export async function selfTest(
	pack: Pack,
	source?: CaseSource,
): Promise<Result<void>> {
	const rules = [...pack.manifest.rules].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	for (const rule of rules) {
		const tested = await selfTestRule(pack, rule, source);
		if (!tested.ok) {
			return err(tested.error);
		}
	}
	return ok(undefined);
}
