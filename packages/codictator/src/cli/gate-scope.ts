// BUG-0014 + SPEC §4.3.2: the gate rule subset over diff scopes. A gate
// judges a staged or pushed diff, not the tree, so enforcers that need
// whole-tree visibility (core/dead-code: an export looks unused when its
// importers are outside the diff) or test-title inputs (core/spec-trace:
// an empty rule scope selects every scoped file, so every normally
// commented file flags) are unsound there. They stay on the human
// `review` command over the tree; every other rule is sound on a diff.
// The phase-5 finer trigger is this rule subset, not a new trigger name.

import type { Finding, Ports, Result } from "../kernel/index.ts";
import {
	err,
	isPackCasePath,
	ok,
	stableStringify,
	withoutPackCases,
} from "../kernel/index.ts";
import { evaluateScope } from "./evaluate.ts";
import type { CommandPorts } from "./shared.ts";
import type { VerdictEmit } from "./verdict-emit.ts";

export const GATE_DIFF_UNSOUND_RULES: ReadonlySet<string> = new Set([
	"core/dead-code",
	"core/spec-trace",
]);

// BUG-0014: gates select the diff-sound subset; the tree review keeps all.
export function isGateDiffSound(ruleId: string): boolean {
	return !GATE_DIFF_UNSOUND_RULES.has(ruleId);
}

// The gate change shape: a diff scope without a trigger of its own. Each
// leg of the gate supplies its trigger, so a diff can never arrive with
// the tree review's trigger and smuggle the unsound rules back in.
export interface GateScope {
	readonly files: ReadonlyArray<string>;
	readonly note: string;
	// SPEC §4.7.1: hook and CI scopes judge content that is not (only) on
	// disk — the staged diff, the pushed diff, the commit messages in range.
	readonly proposedContent?: string;
}

// BUG-0014: canonical-key order, deterministic across OSes (§4.3.6 EC-12).
// One string comparison replaces the engine's field-by-field order, so the
// merge stays under the complexity floor without its own ordering rules.
function compareGateFindings(a: Finding, b: Finding): number {
	const left = gateFindingKey(a);
	const right = gateFindingKey(b);
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

function gateFindingKey(finding: Finding): string {
	return stableStringify({
		ruleId: finding.ruleId,
		path: finding.path ?? "",
		line: finding.line ?? 0,
		code: finding.code ?? "",
		message: finding.message,
	});
}

// BUG-0014: the two gate legs overlap on rules with both triggers
// (core/no-secrets), so the merge dedupes exact findings.
function mergeGateFindings(
	first: ReadonlyArray<Finding>,
	second: ReadonlyArray<Finding>,
): Array<Finding> {
	const seen = new Set<string>();
	const merged: Array<Finding> = [];
	for (const finding of [...first, ...second]) {
		const key = gateFindingKey(finding);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(finding);
	}
	return merged.sort(compareGateFindings);
}

// BUG-0022 + SPEC §4.7.1: the L3 gate judges added lines only, so a commit
// deleting a flagged literal passes while staging one still blocks. A diff
// carries its removed lines as `-` rows; scanning the raw diff would match
// those and make the removal uncommittable.
export function addedLines(diff: string): string {
	return diff
		.split("\n")
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.map((line) => line.slice(1))
		.join("\n");
}

// BUG-0101 + SPEC §4.4.1: the gate diff drops the file sections of pack case
// paths, so their added lines never ride as proposed content. A section runs
// from its `diff --git a/<old> b/<new>` header to the next one.
export function diffWithoutPackCases(diff: string, ports: Ports): string {
	const sections = diff.split(/^(?=diff --git )/m);
	const kept: Array<string> = [];
	for (const section of sections) {
		const header = /^diff --git a\/.* b\/(.+)$/m.exec(section);
		const path = header?.[1];
		if (path !== undefined && isPackCasePath(path, ports.packRoots ?? [])) {
			continue;
		}
		kept.push(section);
	}
	return kept.join("");
}

// BUG-0014 + SPEC §4.3.2: the gate evaluation over a diff scope. The
// pre-tool leg keeps today's fail-closed local verdict byte for byte; the
// review leg adds the diff-sound review subset over the same files, so the
// gate no longer accepts the coverage loss the pre-tool-only mitigation
// took. The diff-unsound rules never run here, whatever their triggers say.
// An emit lands one auditable verdict per leg, so each recorded verdict is
// exactly what its leg judged.
export async function evaluateGateScope(
	ports: CommandPorts,
	packIds: ReadonlyArray<string>,
	scope: GateScope,
	now: string,
	configHash: string,
	options: {
		readonly emit?: VerdictEmit;
		// SPEC §4.9: hook diff legs exclude commit-phase rules whose
		// phase lives elsewhere (commit-msg owns the staged history
		// text, L4 the range); the tree review and L4 pass nothing.
		readonly excludeReviewRuleIds?: ReadonlySet<string>;
	} = {},
): Promise<Result<Array<Finding>>> {
	const files = withoutPackCases(scope.files, ports.packRoots ?? []);
	const input =
		scope.proposedContent === undefined || scope.proposedContent === ""
			? {}
			: { proposedContent: scope.proposedContent };
	const local = await evaluateScope(
		ports,
		packIds,
		{
			trigger: "pre-tool",
			files,
			note: scope.note,
			...input,
		},
		now,
		configHash,
		options.emit === undefined ? {} : { emit: options.emit },
	);
	if (!local.ok) {
		return err(local.error);
	}
	const review = await evaluateScope(
		ports,
		packIds,
		{
			trigger: "review",
			files,
			note: scope.note,
			...input,
		},
		now,
		configHash,
		{
			excludeRuleIds: new Set([
				...GATE_DIFF_UNSOUND_RULES,
				...(options.excludeReviewRuleIds ?? []),
			]),
			...(options.emit === undefined ? {} : { emit: options.emit }),
		},
	);
	if (!review.ok) {
		return err(review.error);
	}
	return ok(mergeGateFindings(local.value, review.value));
}
