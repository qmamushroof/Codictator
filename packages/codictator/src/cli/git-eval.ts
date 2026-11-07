// Split from git-hook.ts by responsibility (core/file-size): this module
// owns the pre-commit/pre-push gate evaluation, so both gate legs land
// their verdict through the emit; git-hook.ts keeps hook dispatch.
import type { Finding, Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { addedLines, evaluateGateScope } from "./gate-scope.ts";
import { printFinding } from "./inspect.ts";
import type { CommandPorts, CommandRequest } from "./shared.ts";
import { printHuman, printJson, reportError } from "./shared.ts";
import type { VerdictEmit } from "./verdict-emit.ts";

export function emitGitVerdict(
	req: CommandRequest,
	hook: string,
	findings: ReadonlyArray<Finding>,
): Result<number> {
	if (req.json) {
		printJson({
			hook,
			decision: findings.length === 0 ? "allow" : "block",
			findings,
		});
	} else {
		for (const finding of findings) {
			printFinding(finding, req.quiet);
		}
		if (findings.length === 0) {
			printHuman(`${hook}: pass`, req.quiet);
		} else {
			printHuman(
				`${hook}: blocked (${String(findings.length)} findings)`,
				req.quiet,
			);
		}
	}
	return ok(findings.length === 0 ? 0 : 1);
}

// SPEC §4.18: the hook verdict routing. Both gate legs land their verdict
// through the emit, so the Timeline shows what the hook judged.
export async function evaluateGitChange(
	ports: CommandPorts,
	req: CommandRequest,
	hook: string,
	packIds: ReadonlyArray<string>,
	files: ReadonlyArray<string>,
	content: string,
	now: string,
	configHash: string,
	emit: VerdictEmit,
): Promise<Result<number>> {
	// BUG-0014 + SPEC §4.3.2: gates judge pre-tool plus the diff-sound
	// review subset, the phase-5 finer trigger as a rule subset. The
	// diff-unsound rules (spec-trace, dead-code) stay on the human
	// `review` command over the tree; a review trigger here once blocked
	// every normally-commented file.
	const evaluated = await evaluateGateScope(
		ports,
		packIds,
		{
			files: [...files],
			note: hook,
			...(content === "" ? {} : { proposedContent: addedLines(content) }),
		},
		now,
		configHash,
		{ emit },
	);
	if (!evaluated.ok) {
		return reportError(evaluated.error, req.json);
	}
	return emitGitVerdict(req, hook, evaluated.value);
}
