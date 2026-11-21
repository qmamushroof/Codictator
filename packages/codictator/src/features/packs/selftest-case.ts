// SPEC §4.4.1, §4.4.4: preparing and judging one self-test case. With a case
// source the case file is the whole world; the verdict compares the findings
// against what the case kind demands (CDX-E212, CDX-E213).
import type { Result } from "../../kernel/index.ts";
import { err, makeError, ok } from "../../kernel/index.ts";
import {
	type CheckContext,
	type Enforcer,
	TRIGGERS,
	type Trigger,
} from "../engine/index.ts";
import { type CaseKind, type CaseSource, readCaseFile } from "./case-file.ts";
import { casePorts } from "./case-ports.ts";
import type { Pack, PackRule } from "./index.ts";
import { resolveManifestEnforcers } from "./registry.ts";

const SELF_TEST_CONFIG_HASH = "self-test";

// The context carries a synthetic instant: enforcers under test decide on
// fixture content, never on wall time.
const SELF_TEST_NOW = "self-test";

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

// SPEC §4.4.4: one resolved enforcer serves a rule. A decl can bind several
// rules, so the binding is found by the rule id the registry stamps on it,
// then by the name the rule declares (hand-built packs).
function resolveEnforcer(
	enforcers: ReadonlyArray<Enforcer>,
	rule: PackRule,
): Enforcer | undefined {
	return (
		enforcers.find((enforcer) => enforcer.id === rule.id) ??
		enforcers.find((enforcer) => enforcer.id === rule.enforcer)
	);
}

interface CaseRun {
	readonly enforcer: Enforcer;
	readonly context: CheckContext;
	readonly expectRules: ReadonlyArray<string>;
}

function unknownEnforcer(rule: PackRule): Result<never> {
	return err(
		makeError(
			"CDX-E205",
			`rule "${rule.id}" names unknown enforcer "${rule.enforcer}"`,
			"Declare the enforcer in the pack or use a built-in parametric enforcer (§4.4.6), then re-run the self-test.",
		),
	);
}

// SPEC §4.4.1: with a case source the case file is the whole world: its
// files sit in an in-memory Fs, the enforcers bind to that Fs, scope.files
// is the sorted keys and the case trigger runs. Without a source (a
// hand-built pack in a unit test) the pack's own enforcers run on an empty
// scope.
export async function prepareCase(
	pack: Pack,
	rule: PackRule,
	kind: CaseKind,
	name: string,
	source: CaseSource | undefined,
): Promise<Result<CaseRun>> {
	if (source === undefined) {
		const enforcer = resolveEnforcer(pack.enforcers, rule);
		if (enforcer === undefined) {
			return unknownEnforcer(rule);
		}
		return ok({
			enforcer,
			context: testContext(rule),
			expectRules: [rule.id],
		});
	}
	const slug = rule.id.split("/").slice(1).join("/");
	const body = await readCaseFile(source, slug, rule.id, kind, name);
	if (!body.ok) {
		return err(body.error);
	}
	const resolved = resolveManifestEnforcers(
		pack.manifest,
		casePorts(body.value.files),
	);
	if (!resolved.ok) {
		return err(resolved.error);
	}
	const enforcer = resolveEnforcer(resolved.value, rule);
	if (enforcer === undefined) {
		return unknownEnforcer(rule);
	}
	return ok({
		enforcer,
		context: {
			trigger: body.value.trigger,
			scope: { files: Object.keys(body.value.files).sort() },
			now: SELF_TEST_NOW,
			configHash: SELF_TEST_CONFIG_HASH,
		},
		expectRules: body.value.expectRules,
	});
}

export function mismatch(
	rule: PackRule,
	kind: CaseKind,
	name: string,
	run: CaseRun,
	found: ReadonlyArray<string>,
): Result<void> {
	if (kind === "violating") {
		const missing = run.expectRules.filter((id) => !found.includes(id));
		if (run.expectRules.length > 0 && missing.length === 0) {
			return ok(undefined);
		}
		return err(
			makeError(
				"CDX-E212",
				`rule "${rule.id}" violating fixture "${name}" ${
					run.expectRules.length === 0
						? "lists no expectRules"
						: `yielded no finding for ${missing.join(", ")}`
				}`,
				"Strengthen the enforcer so the violating case blocks, then re-run the self-test.",
			),
		);
	}
	if (!found.includes(rule.id)) {
		return ok(undefined);
	}
	return err(
		makeError(
			"CDX-E213",
			`rule "${rule.id}" passing fixture "${name}" yielded a finding with this rule id`,
			"Narrow the enforcer so the passing case stays clean, then re-run the self-test.",
		),
	);
}
