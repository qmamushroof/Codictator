// SPEC §5.9 F9 workflow plus F11 review enforcers: marker fixtures
// (sample.txt reports) flag here first, then the claiming task records
// judge real scopes via workflow-real.ts.
import type { Ports } from "../../../kernel/index.ts";
import type { Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor } from "./binding.ts";
import { limitOf, parseMarkerInt, parseMarkers } from "./health-measures.ts";
import {
	forEachMarkerText,
	markerGuard,
	markerRealGuard,
} from "./marker-scan.ts";
import {
	reviewGateReal,
	reviewRoundCapReal,
	workflowGatesReal,
	writesWithinPlanReal,
} from "./workflow-real.ts";

async function markerLine(
	ports: Ports,
	binding: ReturnType<typeof bindRule>,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
	pattern: RegExp,
	message: (file: string) => string,
): Promise<void> {
	await forEachMarkerText(ports, binding, files, findings, (file, text) => {
		if (!pattern.test(text)) {
			return;
		}
		findings.push(
			findingFor(binding, { path: file, message: message(file), vars: { path: file } }),
		);
	});
}

async function markerValue(
	ports: Ports,
	binding: ReturnType<typeof bindRule>,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
	key: string,
	value: string,
	message: (file: string) => string,
): Promise<void> {
	await forEachMarkerText(ports, binding, files, findings, (file, text) => {
		if ((parseMarkers(text).get(key) ?? "") === value) {
			findings.push(
				findingFor(binding, { path: file, message: message(file), vars: { path: file } }),
			);
		}
	});
}

export function resolveWorkflowGates(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			markerLine(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				/^[ \t]*skipped:/m,
				(file) => `mandatory gate skipped in ${file}`,
			),
		async (args) => {
			args.findings.push(
				...(await workflowGatesReal(args.ports, args.files)),
			);
		},
	);
}

export function resolveWritesWithinPlan(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			markerValue(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				"planned",
				"false",
				(file) => `write outside the plan in ${file}`,
			),
		async (args) => {
			args.findings.push(
				...(await writesWithinPlanReal(args.ports, args.files)),
			);
		},
	);
}

export function resolveLoopBreaker(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerGuard(decl, rule, ports, async (args) => {
		const maxRepeats = limitOf(args.binding, "maxRepeats", 3);
		await forEachMarkerText(
			args.ports,
			args.binding,
			args.files,
			args.findings,
			(file, text) => {
				const markers = parseMarkers(text);
				if (overCap(markers, "repeats", "limit", maxRepeats)) {
					const cap = parseMarkerInt(markers, "limit") ?? maxRepeats;
					args.findings.push(
						findingFor(args.binding, {
							path: file,
							message: `loop past ${String(cap)} repeats in ${file}`,
							vars: { path: file, limit: String(cap) },
						}),
					);
				}
			},
		);
	});
}

function overCap(
	markers: Map<string, string>,
	valueKey: string,
	capKey: string,
	defCap: number,
): boolean {
	const value = parseMarkerInt(markers, valueKey);
	const cap = parseMarkerInt(markers, capKey) ?? defCap;
	return value !== undefined && value > cap;
}

export function resolveReviewGate(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			markerValue(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				"review",
				"none",
				(file) => `landing with no review in ${file}`,
			),
		async (args) => {
			args.findings.push(...(await reviewGateReal(args.ports, args.files)));
		},
	);
}

export function resolveReviewRoundCap(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		async (args) => {
			const maxRounds = limitOf(args.binding, "maxRounds", 3);
			await collectRoundMarkers(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				maxRounds,
			);
		},
		async (args) => {
			const maxRounds = limitOf(args.binding, "maxRounds", 3);
			await reviewRoundCapReal(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				maxRounds,
			);
		},
	);
}

async function collectRoundMarkers(
	ports: Ports,
	binding: ReturnType<typeof bindRule>,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
	maxRounds: number,
): Promise<void> {
	await forEachMarkerText(ports, binding, files, findings, (file, text) => {
		const markers = parseMarkers(text);
		const rounds = parseMarkerInt(markers, "rounds");
		const cap = parseMarkerInt(markers, "cap") ?? maxRounds;
		if (rounds !== undefined && rounds > cap) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `review past ${String(cap)} rounds in ${file}`,
					vars: { path: file, limit: String(cap) },
				}),
			);
		}
	});
}
