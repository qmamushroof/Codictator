// SPEC §4.10.4: test integrity. Base and head compare changed files; the
// pack's assertion, skip and suppression patterns arrive as the language
// defaults below, which the pack supplies override at the enforcer layer.
// An integrity exception lifts the block only when the final review round
// acknowledges its id (§4.12.4).
import type { Finding } from "../engine/index.ts";

export interface IntegrityException {
	readonly id: string;
	readonly rule: string;
	readonly path: string;
	readonly reason: string;
}

export interface IntegrityContext {
	readonly exceptions: ReadonlyArray<IntegrityException>;
	readonly acknowledged: ReadonlyArray<string>;
}

export interface FilePair {
	readonly path: string;
	readonly baseText: string;
	readonly headText: string;
}

// SPEC §6.1 TypeScript assertion, skip and suppression shapes. The language
// pack owns the full patterns; these defaults judge the self-hosted suite.
const TS_ASSERTION =
	/\b(?:assert\s*\(|assert\.[A-Za-z]+|expect\s*\(|expect\.[A-Za-z]+)/g;
const TS_SKIP_LINE =
	/^\s*(?:test|it|describe)\s*\.\s*(?:skip|only|todo)\s*\(|^\s*(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/;
const SUPPRESSIONS = [
	"eslint-disable",
	"biome-ignore",
	"@ts-ignore",
	"@ts-expect-error",
	"istanbul ignore",
	"c8 ignore",
	"#pragma warning disable",
	"SuppressMessage",
	"noqa",
	"type: ignore",
	"pragma: no cover",
];

export function countAssertions(text: string): number {
	return text.match(TS_ASSERTION)?.length ?? 0;
}

function addedLines(baseText: string, headText: string): Array<string> {
	const remaining = new Map<string, number>();
	for (const line of baseText.split("\n")) {
		remaining.set(line, (remaining.get(line) ?? 0) + 1);
	}
	const added: Array<string> = [];
	for (const line of headText.split("\n")) {
		const left = remaining.get(line) ?? 0;
		if (left > 0) {
			remaining.set(line, left - 1);
		} else {
			added.push(line);
		}
	}
	return added;
}

function exceptionLifts(
	rule: string,
	path: string,
	ctx: IntegrityContext,
): boolean {
	return ctx.exceptions.some(
		(exception) =>
			exception.rule === rule &&
			exception.path === path &&
			exception.reason.trim().length >= 20 &&
			ctx.acknowledged.includes(exception.id),
	);
}

function integrityFinding(
	rule: string,
	path: string,
	message: string,
	remediation: string,
): Finding {
	return { ruleId: rule, path, message, remediation };
}

function maybeFinding(
	rule: string,
	path: string,
	message: string,
	remediation: string,
	ctx: IntegrityContext,
): Array<Finding> {
	if (exceptionLifts(rule, path, ctx)) {
		return [];
	}
	return [integrityFinding(rule, path, message, remediation)];
}

// SPEC §4.10.4 core/no-assertion-loss: the pack assertion-token count in a
// test file falls. Deleting the file with its feature is the same loss, so
// it reports here and needs the same exception.
export function checkAssertionLoss(
	pair: FilePair,
	ctx: IntegrityContext,
): Array<Finding> {
	const lost = countAssertions(pair.baseText) - countAssertions(pair.headText);
	if (lost <= 0) {
		return [];
	}
	return maybeFinding(
		"core/no-assertion-loss",
		pair.path,
		`assertion count falls by ${lost} in ${pair.path}`,
		`Restore the ${lost} lost assertion(s) in ${pair.path}, or record an integrity exception the final review acknowledges.`,
		ctx,
	);
}

// SPEC §4.10.4 core/no-skipped-tests: added skip, only, todo, focus markers.
// Ratcheted instances predate the check; only added markers report.
export function checkNoSkippedTests(
	pair: FilePair,
	ctx: IntegrityContext,
): Array<Finding> {
	const added = addedLines(pair.baseText, pair.headText).filter((line) =>
		TS_SKIP_LINE.test(line),
	);
	if (added.length === 0) {
		return [];
	}
	return maybeFinding(
		"core/no-skipped-tests",
		pair.path,
		`skip or focus marker added in ${pair.path}: ${added[0]?.trim() ?? ""}`,
		`Remove the marker in ${pair.path}, or record an integrity exception the final review acknowledges.`,
		ctx,
	);
}

// SPEC §4.10.4 core/no-new-suppressions: added lint, type, coverage or
// analyzer suppressions, and grown ignore files, need an exception.
export function checkNoNewSuppressions(
	pair: FilePair,
	ctx: IntegrityContext,
): Array<Finding> {
	const added = addedLines(pair.baseText, pair.headText).filter((line) =>
		SUPPRESSIONS.some((marker) => line.includes(marker)),
	);
	if (added.length === 0) {
		return [];
	}
	return maybeFinding(
		"core/no-new-suppressions",
		pair.path,
		`suppression added in ${pair.path}: ${added[0]?.trim().slice(0, 80) ?? ""}`,
		`Remove the suppression in ${pair.path}, or record an integrity exception the final review acknowledges.`,
		ctx,
	);
}

// SPEC §4.10.4 core/no-fixture-shrink: a fixture or snapshot file loses more
// lines than it gains, or is deleted while a test still references it.
export function checkNoFixtureShrink(
	pair: FilePair,
	stillReferenced: boolean,
	ctx: IntegrityContext,
): Array<Finding> {
	const baseLines = pair.baseText.split("\n").length;
	const headLines = pair.headText.split("\n").length;
	const deleted = pair.headText === "";
	const shrinks = deleted ? stillReferenced : headLines < baseLines;
	if (!shrinks) {
		return [];
	}
	return maybeFinding(
		"core/no-fixture-shrink",
		pair.path,
		deleted
			? `fixture deleted while still referenced: ${pair.path}`
			: `fixture shrinks from ${baseLines} to ${headLines} lines: ${pair.path}`,
		`Restore ${pair.path}, or record an integrity exception the final review acknowledges.`,
		ctx,
	);
}

export interface Thresholds {
	readonly lines: number;
	readonly branches: number;
}

// SPEC §4.10.4 core/no-threshold-lowering: a coverage threshold in a
// pack-known config key falls. Tightening is free.
export function checkNoThresholdLowering(
	path: string,
	base: Thresholds,
	head: Thresholds,
): Array<Finding> {
	const findings: Array<Finding> = [];
	if (head.lines < base.lines) {
		findings.push(
			integrityFinding(
				"core/no-threshold-lowering",
				path,
				`line coverage threshold falls ${base.lines} to ${head.lines} in ${path}`,
				`Restore the line coverage threshold in ${path}; tightening only.`,
			),
		);
	}
	if (head.branches < base.branches) {
		findings.push(
			integrityFinding(
				"core/no-threshold-lowering",
				path,
				`branch coverage threshold falls ${base.branches} to ${head.branches} in ${path}`,
				`Restore the branch coverage threshold in ${path}; tightening only.`,
			),
		);
	}
	return findings;
}

const COMMAND_WEAKENERS = [
	"|| true",
	"; exit 0",
	"--passWithNoTests",
	"continue-on-error",
];

// SPEC §4.10.4 core/test-command-intact: the test command never weakens.
export function checkTestCommandIntact(
	baseCmd: ReadonlyArray<string>,
	headCmd: ReadonlyArray<string>,
): Array<Finding> {
	const base = baseCmd.join(" ");
	const head = headCmd.join(" ");
	for (const weakener of COMMAND_WEAKENERS) {
		if (!base.includes(weakener) && head.includes(weakener)) {
			return [
				integrityFinding(
					"core/test-command-intact",
					"(test command)",
					`test command weakens with "${weakener}"`,
					`Remove "${weakener}" from the test command; a passing run must mean passing tests.`,
				),
			];
		}
	}
	const baseGlobs = baseCmd.filter((token) => token.includes("tests/"));
	const dropped = baseGlobs.filter((glob) => !head.includes(glob));
	if (dropped.length > 0) {
		return [
			integrityFinding(
				"core/test-command-intact",
				"(test command)",
				`test command drops its globs: ${dropped.join(", ")}`,
				`Restore the dropped test globs; the test command keeps its scope.`,
			),
		];
	}
	return [];
}

// The per-file evaluation entry: loss, skips and suppressions together.
export function checkTestIntegrity(
	pair: FilePair,
	ctx: IntegrityContext,
): Array<Finding> {
	return [
		...checkAssertionLoss(pair, ctx),
		...checkNoSkippedTests(pair, ctx),
		...checkNoNewSuppressions(pair, ctx),
	];
}
