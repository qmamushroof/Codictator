// SPEC §4.4.6: rule data bound into parametric enforcers at load. The
// engine calls check with empty params (phase 4), so the loader binds the
// rule id, triggers, scope globs, remediation template and tunable defaults
// into the enforcer closure; per-kind config arrives through decl args.
import type { CdxError, Fs, Result } from "../../../kernel/index.ts";
import { err, globMatch, makeError, ok } from "../../../kernel/index.ts";
import { type Finding, TRIGGERS, type Trigger } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import { field, isRecord } from "../manifest.ts";

export interface RuleBinding {
	readonly ruleId: string;
	readonly triggers: ReadonlyArray<Trigger>;
	readonly scopeGlobs: ReadonlyArray<string>;
	readonly remediation: string;
	readonly tunables: Readonly<Record<string, unknown>>;
}

function isTrigger(value: string): value is Trigger {
	for (const trigger of TRIGGERS) {
		if (trigger === value) {
			return true;
		}
	}
	return false;
}

// SPEC §4.4.3 step 4: the binding keeps the rule's own triggers, scope and
// tunable defaults; config-layer tightening applies them later (phase 4).
export function bindRule(rule: PackRule): RuleBinding {
	const triggers: Array<Trigger> = [];
	for (const trigger of rule.triggers) {
		if (isTrigger(trigger)) {
			triggers.push(trigger);
		}
	}
	const tunables: Record<string, unknown> = {};
	for (const [name, param] of Object.entries(rule.params)) {
		if (isRecord(param)) {
			tunables[name] = field(param, "default");
		}
	}
	return {
		ruleId: rule.id,
		triggers,
		scopeGlobs: [...rule.scope],
		remediation: rule.remediation,
		tunables,
	};
}

export function tunableNumber(
	binding: RuleBinding,
	name: string,
): number | undefined {
	const value: unknown = binding.tunables[name];
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return undefined;
}

export function tunableStringList(
	binding: RuleBinding,
	name: string,
): Array<string> | undefined {
	const value: unknown = binding.tunables[name];
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string")
	) {
		return [...value];
	}
	return undefined;
}

// SPEC §4.3.3 step 1: an empty rule scope selects every trigger-scoped
// file; otherwise a file must match at least one rule glob. Sorted, so the
// enforcer order never depends on the trigger's arrival order (§4.3.6).
export function selectFiles(
	scopeFiles: ReadonlyArray<string>,
	scopeGlobs: ReadonlyArray<string>,
): Array<string> {
	const sorted = [...scopeFiles].sort();
	if (scopeGlobs.length === 0) {
		return sorted;
	}
	return sorted.filter((file) =>
		scopeGlobs.some((glob) => globMatch(glob, file)),
	);
}

// SPEC §7.3: remediation placeholders fill from the finding; a placeholder
// with no value stays literal rather than inventing text.
export function fillRemediation(
	template: string,
	vars: Readonly<Record<string, string>>,
): string {
	let out = template;
	for (const key of Object.keys(vars)) {
		const value: unknown = vars[key];
		if (typeof value !== "string") {
			continue;
		}
		out = out.split(`{${key}}`).join(value);
	}
	return out;
}

export function findingFor(
	binding: RuleBinding,
	init: Omit<Finding, "ruleId" | "remediation"> & {
		readonly vars?: Readonly<Record<string, string>>;
	},
): Finding {
	const { vars, ...rest } = init;
	return {
		...rest,
		ruleId: binding.ruleId,
		remediation: fillRemediation(binding.remediation, vars ?? {}),
	};
}

// Fail-closed reads: no file content in the message (§9.2); the engine
// keeps CDX-E findings unwaived and blocking (§4.3.4, §4.3.8).
export function readErrorFinding(
	binding: RuleBinding,
	path: string,
	error: CdxError,
	detail: string,
): Finding {
	return findingFor(binding, {
		path,
		code: error.code,
		message: `the guard could not ${detail} ${path}; the code was not judged`,
	});
}

// One port read for every parametric kind: bytes for sizes, lossy text for
// patterns. Lossy decoding never fails on binary input, so only I/O errors
// fail closed; determinism comes from the port, never the content.
export async function readLossyText(
	fs: Fs,
	path: string,
): Promise<Result<{ readonly bytes: number; readonly text: string }>> {
	const loaded = await fs.read(path);
	if (!loaded.ok) {
		return { ok: false, error: loaded.error };
	}
	return {
		ok: true,
		value: {
			bytes: loaded.value.length,
			text: new TextDecoder("utf-8", { fatal: false }).decode(loaded.value),
		},
	};
}

// Shared pack-author arg narrowing: every kind takes an args object, and
// malformed args fail the load (CDX-E203) before any check runs. An absent
// or empty args object means the pack declares no binding: the resolver
// defers the decl (fail-closed E901) instead of failing the whole load, so
// frozen manifests keep loading while unbound enforcers stay inert.
export function bindingError(declId: string, detail: string): Result<never> {
	return err(
		makeError(
			"CDX-E203",
			`pack enforcer "${declId}" ${detail}`,
			"Fix the enforcer args so they match SPEC §4.4.6, then reload the pack.",
		),
	);
}

export function isUnboundArgs(args: unknown): boolean {
	return (
		args === undefined || (isRecord(args) && Object.keys(args).length === 0)
	);
}

export function argsRecord(
	declId: string,
	args: unknown,
): Result<Record<string, unknown>> {
	if (!isRecord(args)) {
		return bindingError(declId, "needs an args object for its §4.4.6 kind");
	}
	return ok(args);
}

export function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function stringList(value: unknown): Array<string> | undefined {
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string")
	) {
		return [...value];
	}
	return undefined;
}

export function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
