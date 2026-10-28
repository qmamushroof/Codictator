// SPEC §4.4.4: self-test. Every rule runs its violating fixtures (each must
// yield a finding with the rule id) and its passing fixtures (none may).
// A fixture exceeding twice the enforcer budget fails CDX-E215; an
// enforcer that throws fails CDX-E901. Both fail closed with the pack
// inert, like the engine treats them (SPEC §4.3.8).
import type { Result } from "../../kernel/index.ts";
import { err, makeError, ok } from "../../kernel/index.ts";
import {
	type CheckContext,
	type Enforcer,
	type Finding,
	TRIGGERS,
	type Trigger,
} from "../engine/index.ts";
import type { Pack, PackRule } from "./index.ts";
import { checkParam } from "./params.ts";

const SELF_TEST_CONFIG_HASH = "self-test";

// No clock port reaches the self-test signature, so the context carries a
// synthetic instant. Enforcers under test decide on fixture content, never
// on wall time; real fixture runs take a real clock in a later phase.
const SELF_TEST_NOW = "self-test";

const TIMED_OUT = { timedOut: true };

function toTrigger(value: unknown): Trigger {
	if (typeof value === "string") {
		for (const trigger of TRIGGERS) {
			if (trigger === value) {
				return trigger;
			}
		}
	}
	return "startup";
}

function testContext(rule: PackRule): CheckContext {
	return {
		trigger: toTrigger(rule.triggers[0]),
		scope: { files: [] },
		now: SELF_TEST_NOW,
		configHash: SELF_TEST_CONFIG_HASH,
	};
}

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
): Promise<Result<Array<Finding>>> {
	let pending: Promise<Array<Finding>>;
	try {
		pending = enforcer.check(testContext(rule), {});
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

// SPEC §4.4.4: the enforcer for a self-test is found by the name the rule
// declares, falling back to the rule id so hand-built packs keep working.
function resolveEnforcer(pack: Pack, rule: PackRule): Enforcer | undefined {
	for (const enforcer of pack.enforcers) {
		if (enforcer.id === rule.enforcer) {
			return enforcer;
		}
	}
	for (const enforcer of pack.enforcers) {
		if (enforcer.id === rule.id) {
			return enforcer;
		}
	}
	return undefined;
}

async function selfTestRule(pack: Pack, rule: PackRule): Promise<Result<void>> {
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
	const enforcer = resolveEnforcer(pack, rule);
	if (enforcer === undefined) {
		return err(
			makeError(
				"CDX-E205",
				`rule "${rule.id}" names unknown enforcer "${rule.enforcer}"`,
				"Declare the enforcer in the pack or use a built-in parametric enforcer (§4.4.6), then re-run the self-test.",
			),
		);
	}
	for (const name of rule.fixtures.violating) {
		const ran = await runCase(enforcer, rule, name);
		if (!ran.ok) {
			return err(ran.error);
		}
		if (!ran.value.some((finding) => finding.ruleId === rule.id)) {
			return err(
				makeError(
					"CDX-E212",
					`rule "${rule.id}" violating fixture "${name}" yielded no finding with this rule id`,
					"Strengthen the enforcer so the violating case blocks, then re-run the self-test.",
				),
			);
		}
	}
	for (const name of rule.fixtures.passing) {
		const ran = await runCase(enforcer, rule, name);
		if (!ran.ok) {
			return err(ran.error);
		}
		if (ran.value.some((finding) => finding.ruleId === rule.id)) {
			return err(
				makeError(
					"CDX-E213",
					`rule "${rule.id}" passing fixture "${name}" yielded a finding with this rule id`,
					"Narrow the enforcer so the passing case stays clean, then re-run the self-test.",
				),
			);
		}
	}
	return ok(undefined);
}

// SPEC §4.4.4: self-test every rule against its fixtures before use. Rules
// run in id order so the first failure is deterministic.
export async function selfTest(pack: Pack): Promise<Result<void>> {
	const rules = [...pack.manifest.rules].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	for (const rule of rules) {
		const tested = await selfTestRule(pack, rule);
		if (!tested.ok) {
			return err(tested.error);
		}
	}
	return ok(undefined);
}
