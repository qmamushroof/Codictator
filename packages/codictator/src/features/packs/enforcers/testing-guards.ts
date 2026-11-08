// SPEC §5.4 F4 ATDD plus tests enforcers: marker fixtures (sample.txt
// reports) flag here first, then the committed task records judge real
// scopes through testing-real.ts helpers.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { type bindRule, findingFor } from "./binding.ts";
import {
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";
import {
	forEachMarkerText,
	markerGuard,
	markerRealGuard,
} from "./marker-scan.ts";
import {
	redBeforeGreenReal,
	regressionTestReal,
	testKindsReal,
} from "./testing-real.ts";

export function resolveSpecTrace(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerGuard(decl, rule, ports, async (args) => {
		for (const file of args.files) {
			const text = await loadScopeText(
				args.ports,
				args.binding,
				file,
				args.findings,
			);
			if (text === undefined || /\[§\d/.test(text)) {
				continue;
			}
			args.findings.push(
				findingFor(args.binding, {
					path: file,
					message: `test without a SPEC reference in ${file}`,
					vars: { path: file },
				}),
			);
		}
	});
}

async function markerFindings(
	ports: Ports,
	binding: ReturnType<typeof bindRule>,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
	key: string,
	substr: string,
	message: (file: string) => string,
): Promise<void> {
	await forEachMarkerText(ports, binding, files, findings, (file, text) => {
		const hit =
			substr === ""
				? (parseMarkers(text).get(key) ?? "") === "none"
				: text.includes(substr);
		if (hit) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: message(file),
					vars: { path: file },
				}),
			);
		}
	});
}

export function resolveRedBeforeGreen(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			markerFindings(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				"red-proof",
				"",
				(file) => `fix with no red proof in ${file}`,
			),
		async (args) => {
			args.findings.push(...(await redBeforeGreenReal(args.ports, args.files)));
		},
	);
}

export function resolveTestKindsByScenario(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			markerFindings(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				"",
				"unit only",
				(file) => `scenario covered by unit tests alone in ${file}`,
			),
		async (args) => {
			args.findings.push(...(await testKindsReal(args.ports, args.files)));
		},
	);
}

export function resolveRegressionTestForFix(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			markerFindings(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				"regression-test",
				"",
				(file) => `fix with no regression test in ${file}`,
			),
		async (args) => {
			args.findings.push(...(await regressionTestReal(args.ports, args.files)));
		},
	);
}

export function resolveCoverageFloor(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerGuard(decl, rule, ports, async (args) => {
		const floor = (name: string, fallback: number): number => {
			const raw = args.binding.tunables[name];
			return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
		};
		for (const file of args.files) {
			const text = await loadScopeText(
				args.ports,
				args.binding,
				file,
				args.findings,
			);
			if (text === undefined) {
				continue;
			}
			if (underFloor(parseMarkers(text), floor)) {
				args.findings.push(
					findingFor(args.binding, {
						path: file,
						message: `coverage under the floor in ${file}`,
						vars: {
							path: file,
							limit: `${String(floor("lines", 90))}/${String(floor("branches", 80))}`,
						},
					}),
				);
			}
		}
	});
}

function underFloor(
	markers: Map<string, string>,
	floor: (name: string, fallback: number) => number,
): boolean {
	const lines = parseMarkerInt(markers, "lines");
	const branches = parseMarkerInt(markers, "branches");
	return (
		(lines !== undefined && lines < floor("lines", 90)) ||
		(branches !== undefined && branches < floor("branches", 80))
	);
}
