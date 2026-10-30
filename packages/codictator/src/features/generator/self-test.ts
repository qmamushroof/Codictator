// SPEC §4.16.3: in-memory self-test of a drafted pack. Mirrors the §4.4.4
// semantics (each violating fixture must flag, each passing fixture must
// stay clean) without the loader, so draftPack stays pure and deterministic.
import { err, makeError, ok, type Result } from "../../kernel/index.ts";

export interface RuleSpec {
	readonly id: string;
	readonly kind: string;
	readonly pattern?: string;
	readonly reason: string;
	readonly remediation: string;
	readonly tier: "floor" | "tunable";
	readonly violatingFixture: string;
	readonly passingFixture: string;
}

function compilePattern(spec: RuleSpec): Result<RegExp> {
	if (spec.pattern === undefined) {
		return err(
			makeError(
				"CDX-E205",
				`rule "${spec.id}" needs a pattern for a pattern enforcer`,
				"Give the rule a pattern in its template params, then retry the draft.",
			),
		);
	}
	try {
		return ok(new RegExp(spec.pattern));
	} catch {
		return err(
			makeError(
				"CDX-E205",
				`rule "${spec.id}" carries a pattern the regex engine rejects`,
				"Fix the pattern so it compiles, then retry the draft.",
			),
		);
	}
}

function testForbid(spec: RuleSpec, expression: RegExp): Result<void> {
	if (!expression.test(spec.violatingFixture)) {
		return err(
			makeError(
				"CDX-E212",
				`rule "${spec.id}" violating fixture yielded no finding with this rule id`,
				"Strengthen the drafted pattern so the violating case blocks, then retry the draft.",
			),
		);
	}
	if (expression.test(spec.passingFixture)) {
		return err(
			makeError(
				"CDX-E213",
				`rule "${spec.id}" passing fixture yielded a finding with this rule id`,
				"Narrow the drafted pattern so the passing case stays clean, then retry the draft.",
			),
		);
	}
	return ok(undefined);
}

function testRequire(spec: RuleSpec, expression: RegExp): Result<void> {
	if (expression.test(spec.violatingFixture)) {
		return err(
			makeError(
				"CDX-E212",
				`rule "${spec.id}" violating fixture should lack the required text`,
				"Fix the violating fixture so it misses the required pattern, then retry the draft.",
			),
		);
	}
	if (!expression.test(spec.passingFixture)) {
		return err(
			makeError(
				"CDX-E213",
				`rule "${spec.id}" passing fixture should carry the required text`,
				"Fix the passing fixture so it carries the required pattern, then retry the draft.",
			),
		);
	}
	return ok(undefined);
}

function testSpec(spec: RuleSpec): Result<void> {
	if (spec.violatingFixture.length === 0) {
		return err(
			makeError(
				"CDX-E211",
				`rule "${spec.id}" has no violating fixture`,
				"Add a violating fixture, then retry the draft.",
			),
		);
	}
	if (spec.remediation.length === 0 || spec.remediation === spec.reason) {
		return err(
			makeError(
				"CDX-E214",
				`rule "${spec.id}" remediation is empty or repeats its reason`,
				"Write remediation as Do-instead text distinct from Why, then retry the draft.",
			),
		);
	}
	if (spec.kind !== "pattern-forbid" && spec.kind !== "pattern-require") {
		return err(
			makeError(
				"CDX-E205",
				`rule "${spec.id}" needs the loader-backed self-test for kind "${spec.kind}"`,
				"Draft a pattern template offline, or run the pack self-test after materialising.",
			),
		);
	}
	const compiled = compilePattern(spec);
	if (!compiled.ok) {
		return err(compiled.error);
	}
	if (spec.kind === "pattern-require") {
		return testRequire(spec, compiled.value);
	}
	return testForbid(spec, compiled.value);
}

// SPEC §4.16.3: self-test every drafted rule; the first failure names its
// rule so the report says which fixture failed. Rules run in id order so the
// first failure is deterministic.
export function selfTestSpecs(specs: ReadonlyArray<RuleSpec>): Result<void> {
	const ordered = [...specs].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	for (const spec of ordered) {
		const tested = testSpec(spec);
		if (!tested.ok) {
			return err(tested.error);
		}
	}
	return ok(undefined);
}
