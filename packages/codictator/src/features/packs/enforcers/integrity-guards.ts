// SPEC §5.5 F5 test-integrity enforcers, plus the §5.11/§4.14 F12
// integrity-owned checks (no-bypass, repo-hygiene). Each rule first honours
// the fixture measure report (`sample.txt` marker files), then stays quiet
// when the report carries no violation, so violating fixtures flag and
// passing fixtures stay clean (SPEC §4.4.4).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import {
	baseEnforcer,
	loadScopeText,
	parseMarkers,
} from "./health-measures.ts";

function arrowPair(text: string): [number, number] | undefined {
	const match = /(\d+)\s*->\s*(\d+)/.exec(text);
	if (match === null) {
		return undefined;
	}
	return [
		Number.parseInt(match[1] ?? "0", 10),
		Number.parseInt(match[2] ?? "0", 10),
	];
}

// SPEC §5.5 core/no-assertion-loss: a test edit that drops assertions flags.
export function resolveNoAssertionLoss(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const pair = arrowPair(parseMarkers(text).get("assertions") ?? text);
				if (pair !== undefined && pair[1] < pair[0]) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `assertion count falls in ${file}`,
							vars: {
								path: file,
								value: `${String(pair[0])} -> ${String(pair[1])}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

const SKIP_PATTERN =
	/(?:test|it|describe)\s*\.\s*(?:skip|only|todo)\s*\(|^\s*(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/m;

// SPEC §5.5 core/no-skipped-tests: an added skip, only, todo or focus
// marker flags. Skips inside strings and comments are vectors and prose,
// not skipped tests, so the pattern runs on blanked code.
export function resolveNoSkippedTests(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !SKIP_PATTERN.test(blankCode(text))) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `skipped or focused test in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

const SUPPRESSION_PATTERN =
	/eslint-disable|biome-ignore|@ts-ignore|@ts-expect-error|istanbul ignore|c8 ignore|#pragma warning disable|SuppressMessage|noqa|type: ignore|pragma: no cover/;

// SPEC §5.5 core/no-new-suppressions: an added lint, type or coverage
// suppression flags. The report is an `added:` marker line; bare words in
// prose, vocabulary tables, pattern sources and test vectors are not
// added suppressions.
export function resolveNoNewSuppressions(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const added = [...text.matchAll(/^[ \t]*added:[ \t]*(.+)$/gm)].some(
					(match) => SUPPRESSION_PATTERN.test(match[1] ?? ""),
				);
				if (!added) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `new suppression in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.5 core/no-fixture-shrink: a fixture that loses rows flags.
export function resolveNoFixtureShrink(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const pair = arrowPair(parseMarkers(text).get("fixture-rows") ?? text);
				if (pair !== undefined && pair[1] < pair[0]) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fixture shrinks in ${file}`,
							vars: {
								path: file,
								value: `${String(pair[0])} -> ${String(pair[1])}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.5 core/no-threshold-lowering: a lowered coverage floor flags.
export function resolveNoThresholdLowering(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				for (const key of ["floor-lines", "floor-branches"]) {
					const pair = arrowPair(markers.get(key) ?? "");
					if (pair !== undefined && pair[1] < pair[0]) {
						findings.push(
							findingFor(binding, {
								path: file,
								message: `threshold lowered in ${file}`,
								vars: {
									path: file,
									limit: String(pair[0]),
									value: String(pair[1]),
								},
							}),
						);
					}
				}
			}
			return findings;
		}),
	);
}

const COMMAND_WEAKENERS = [
	"|| true",
	"; exit 0",
	"--passWithNoTests",
	"continue-on-error",
];

// SPEC §5.5 core/test-command-intact: a weakened or narrowed test command
// flags. The report is a `test:` marker line; substrings in prose, CI
// docs and the guard's own source are not test commands.
const NARROWED_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|cs|go|rs)(?![\w])/;

export function resolveTestCommandIntact(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const weakened = [...text.matchAll(/^[ \t]*test:[ \t]*(.+)$/gm)].some(
					(match) => {
						const command = match[1] ?? "";
						return (
							COMMAND_WEAKENERS.some((weakener) =>
								command.includes(weakener),
							) || NARROWED_FILE.test(command)
						);
					},
				);
				if (!weakened) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `test command weakened in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.5 core/no-baseline-raise: a raised baseline entry flags.
export function resolveNoBaselineRaise(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const pair = arrowPair(parseMarkers(text).get("baseline") ?? text);
				if (pair !== undefined && pair[1] > pair[0]) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `baseline raised in ${file}`,
							vars: {
								path: file,
								value: `${String(pair[0])} -> ${String(pair[1])}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}
