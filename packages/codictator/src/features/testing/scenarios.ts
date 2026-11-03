// SPEC §4.10.3: the scenario classifier. Inputs are caller-supplied facts
// (changed paths, import edges, pack patterns); the import graph of §4.11
// arrives as data, so this module never imports it.
import { globMatch } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";

export type TestKind =
	| "acceptance"
	| "unit"
	| "integration"
	| "architecture"
	| "stress"
	| "load"
	| "regression";

export interface ScenarioChange {
	readonly path: string;
	readonly trivialOnly: boolean;
	readonly isTest: boolean;
	readonly isDoc: boolean;
	readonly isEntryPoint: boolean;
	readonly addsCrossModuleImport: boolean;
	readonly importsIoPackage: boolean;
	readonly isNewModule: boolean;
	readonly isDeletedModule: boolean;
	readonly isRenamedModule: boolean;
}

export interface ScenarioOptions {
	readonly hotPaths: ReadonlyArray<string>;
	readonly taskType: string;
	readonly archConfigChanged: boolean;
}

export interface ChangedTest {
	readonly path: string;
	readonly imports: ReadonlyArray<string>;
}

export interface TestKindsInput {
	readonly required: ReadonlyArray<TestKind>;
	readonly changedTests: ReadonlyArray<ChangedTest>;
	readonly changedModules: ReadonlyArray<string>;
	readonly importMap: Readonly<Record<string, ReadonlyArray<string>>>;
	readonly mappedModules: ReadonlyArray<string>;
	readonly kindGlobs: Readonly<Record<string, ReadonlyArray<string>>>;
	readonly budgets: Readonly<Record<string, boolean>>;
}

// SPEC §4.10.3: the detected facts map to required kinds.
export function requiredTestKinds(
	changes: ReadonlyArray<ScenarioChange>,
	options: ScenarioOptions,
): Array<TestKind> {
	const required = new Set<TestKind>();
	for (const change of changes) {
		if (change.isTest || change.isDoc || change.trivialOnly) {
			continue;
		}
		required.add("acceptance");
		required.add("unit");
		if (
			change.isEntryPoint ||
			change.addsCrossModuleImport ||
			change.importsIoPackage
		) {
			required.add("integration");
		}
		if (
			change.isNewModule ||
			change.isDeletedModule ||
			change.isRenamedModule ||
			change.addsCrossModuleImport ||
			options.archConfigChanged
		) {
			required.add("architecture");
		}
		if (options.hotPaths.some((glob) => globMatch(glob, change.path))) {
			required.add("stress");
			required.add("load");
		}
	}
	if (options.taskType === "fix") {
		required.add("regression");
	}
	return [...required].sort();
}

function reachableModules(
	test: ChangedTest,
	importMap: Readonly<Record<string, ReadonlyArray<string>>>,
): Set<string> {
	const reached = new Set<string>(test.imports);
	for (const direct of test.imports) {
		for (const second of importMap[direct] ?? []) {
			reached.add(second);
		}
	}
	return reached;
}

function coversChangedModule(
	input: TestKindsInput,
	globs: ReadonlyArray<string>,
	test: ChangedTest,
	changed: ReadonlySet<string>,
): boolean {
	if (!globs.some((glob) => globMatch(glob, test.path))) {
		return false;
	}
	const reached = reachableModules(test, input.importMap);
	return [...changed].some((module) => reached.has(module));
}

function coveringTests(
	input: TestKindsInput,
	kind: TestKind,
	changed: ReadonlySet<string>,
): Array<ChangedTest> {
	const globs = input.kindGlobs[kind] ?? [];
	return input.changedTests.filter((test) =>
		coversChangedModule(input, globs, test, changed),
	);
}

function architectureFinding(
	input: TestKindsInput,
	changed: ReadonlySet<string>,
): Finding | undefined {
	const unmapped = [...changed].filter(
		(module) => !input.mappedModules.includes(module),
	);
	if (unmapped.length === 0) {
		return undefined;
	}
	return kindFinding(
		`architecture test missing: ${unmapped.join(", ")} map to no architecture module`,
		`Map ${unmapped.join(", ")} in config.architecture so the arch guard covers them.`,
	);
}

function missingKindFinding(
	input: TestKindsInput,
	kind: TestKind,
	changed: ReadonlySet<string>,
): Finding {
	const globs = input.kindGlobs[kind] ?? [];
	return kindFinding(
		`${kind} test missing for changed ${[...changed].join(", ") || "files"}`,
		`Add a ${kind} test under ${globs.join(", ") || "its kind globs"} importing a changed module.`,
	);
}

function budgetFindings(
	kind: TestKind,
	covering: ReadonlyArray<ChangedTest>,
	budgets: Readonly<Record<string, boolean>>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const test of covering) {
		if (budgets[test.path] !== true) {
			findings.push(
				kindFinding(
					`${kind} test without a budget line: ${test.path}`,
					`Declare a codictator:budget line (p95, p99, rps or maxMs) in ${test.path}.`,
				),
			);
		}
	}
	return findings;
}

function collectKindFindings(
	input: TestKindsInput,
	kind: TestKind,
	changed: ReadonlySet<string>,
	findings: Array<Finding>,
): void {
	if (kind === "architecture") {
		const missing = architectureFinding(input, changed);
		if (missing !== undefined) {
			findings.push(missing);
		}
		return;
	}
	const covering = coveringTests(input, kind, changed);
	if (covering.length === 0) {
		findings.push(missingKindFinding(input, kind, changed));
		return;
	}
	if (kind === "stress" || kind === "load") {
		findings.push(...budgetFindings(kind, covering, input.budgets));
	}
}

// A kind is satisfied by a changed test file under its kind globs that
// imports (transitively, depth 2) a changed module. Architecture is
// satisfied when config.architecture maps every changed module, because
// the arch guard (§4.11) is the architecture test. Stress and load tests
// each declare a codictator:budget line.
export function checkTestKinds(input: TestKindsInput): Array<Finding> {
	const findings: Array<Finding> = [];
	const changed = new Set(input.changedModules);
	for (const kind of input.required) {
		collectKindFindings(input, kind, changed, findings);
	}
	return findings;
}

function kindFinding(message: string, remediation: string): Finding {
	return {
		ruleId: "core/test-kinds-by-scenario",
		message,
		remediation,
	};
}
