// SPEC §4.10.1: the SPEC trace. Every acceptance test carries a reference
// matching config.spec.refPattern; every reference resolves to a heading or
// an EC row; every code task lists references its declared tests cite. The
// spec index is caller-supplied data (the loader owns the SPEC files), so
// this module never reads the filesystem.
import { globMatch } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";

export const DEFAULT_REF_PATTERN = "\\[(§[\\d.]+(?: EC-\\d+)?)\\]";

export interface SpecReference {
	readonly section: string;
	readonly ec: number | undefined;
	readonly raw: string;
}

export interface SpecIndex {
	readonly headings: ReadonlySet<string>;
	readonly ecRows: ReadonlyMap<string, ReadonlySet<number>>;
}

export interface TracedTest {
	readonly path: string;
	readonly title: string;
}

function parseInner(raw: string): SpecReference | undefined {
	const match = /^§([\d.]+)(?: EC-(\d+))?$/.exec(raw);
	if (match === null) {
		return undefined;
	}
	const section = match[1] ?? "";
	const ecText = match[2];
	return {
		section,
		ec: ecText === undefined ? undefined : Number.parseInt(ecText, 10),
		raw,
	};
}

// SPEC §4.10.1: config.spec.refPattern finds references in test titles.
export function parseSpecRefs(
	title: string,
	refPattern: string = DEFAULT_REF_PATTERN,
): Array<SpecReference> {
	const refs: Array<SpecReference> = [];
	const pattern = new RegExp(refPattern, "g");
	let match = pattern.exec(title);
	while (match !== null) {
		const parsed = parseInner(match[1] ?? "");
		if (parsed !== undefined) {
			refs.push(parsed);
		}
		match = pattern.exec(title);
	}
	return refs;
}

function nearestSections(wanted: string, known: ReadonlySet<string>): string {
	const scored = [...known]
		.map((section) => {
			let shared = 0;
			while (
				shared < wanted.length &&
				shared < section.length &&
				wanted[shared] === section[shared]
			) {
				shared += 1;
			}
			return { section, shared };
		})
		.sort((a, b) => b.shared - a.shared || (a.section < b.section ? -1 : 1));
	return scored
		.slice(0, 3)
		.map((entry) => `§${entry.section}`)
		.join(", ");
}

function nearestEcs(wanted: number, known: ReadonlySet<number>): string {
	return [...known]
		.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)
		.slice(0, 3)
		.map((ec) => `EC-${ec}`)
		.join(", ");
}

function traceFinding(
	path: string,
	message: string,
	remediation: string,
): Finding {
	return { ruleId: "core/spec-trace", path, message, remediation };
}

// SPEC §4.10.1 core/spec-trace: acceptance tests trace; references resolve;
// remediation lists the nearest existing ids.
export function checkSpecTrace(
	tests: ReadonlyArray<TracedTest>,
	spec: SpecIndex,
	acceptanceGlobs: ReadonlyArray<string> = ["tests/acceptance/**"],
	refPattern: string = DEFAULT_REF_PATTERN,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const test of tests) {
		if (!acceptanceGlobs.some((glob) => globMatch(glob, test.path))) {
			continue;
		}
		const refs = parseSpecRefs(test.title, refPattern);
		if (refs.length === 0) {
			findings.push(
				traceFinding(
					test.path,
					`acceptance test without a SPEC reference: ${test.title}`,
					`Give the test in ${test.path} a literal SPEC reference, e.g. [§4.10 EC-4].`,
				),
			);
			continue;
		}
		for (const ref of refs) {
			if (!spec.headings.has(ref.section)) {
				findings.push(
					traceFinding(
						test.path,
						`SPEC reference to unknown section: ${ref.raw}`,
						`Point ${test.path} at an existing section. Nearest: ${nearestSections(ref.section, spec.headings)}.`,
					),
				);
				continue;
			}
			if (ref.ec !== undefined) {
				const rows = spec.ecRows.get(ref.section) ?? new Set<number>();
				if (!rows.has(ref.ec)) {
					findings.push(
						traceFinding(
							test.path,
							`SPEC reference to unknown EC row: ${ref.raw}`,
							`Point ${test.path} at an existing EC row. Nearest: ${nearestEcs(ref.ec, rows)}.`,
						),
					);
				}
			}
		}
	}
	return findings;
}

export interface PlannedTask {
	readonly type: string;
	readonly specRefs: ReadonlyArray<string>;
	readonly declaredTests: ReadonlyArray<TracedTest>;
}

// SPEC §4.10.1 planning gate: every code task lists spec references, each
// cited by at least one declared test; zero declared tests blocks.
export function checkPlanningGate(task: PlannedTask): Array<Finding> {
	const findings: Array<Finding> = [];
	if (task.type !== "code" && task.type !== "fix") {
		return findings;
	}
	if (task.declaredTests.length === 0) {
		findings.push(
			traceFinding(
				"(task)",
				`code task declares zero tests`,
				"Declare at least one test for the code task before planning it.",
			),
		);
	}
	if (task.specRefs.length === 0) {
		findings.push(
			traceFinding(
				"(task)",
				`code task lists zero SPEC references`,
				"List at least one SPEC reference on the code task.",
			),
		);
	}
	for (const test of task.declaredTests) {
		const cites = parseSpecRefs(test.title).some((ref) =>
			task.specRefs.includes(ref.raw),
		);
		if (!cites) {
			findings.push(
				traceFinding(
					test.path,
					`declared test cites none of the task references: ${test.title}`,
					`Cite one of ${task.specRefs.join(", ")} in ${test.path}.`,
				),
			);
		}
	}
	return findings;
}
