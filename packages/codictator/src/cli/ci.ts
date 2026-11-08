// SPEC §4.15: CI verify, sweep and bot-change recording. Verify fails
// closed on an unreachable base (CDX-E503) and advises where protection
// reads are unavailable; sweep plans the single codictator/sweep PR.
import {
	checkCi,
	type ProtectionRead,
	planSweep,
	readProtection,
	renderWorkflow,
} from "../features/ci/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { checkCommitTrailers } from "../features/integrity/index.ts";
import { checkRedProofReRun } from "../features/testing/proofs.ts";
import type { Finding, Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { ciRecordBotChange } from "./ci-bot-change.ts";
import { verifyInputs } from "./ci-inputs.ts";
import {
	ciPackIds,
	parseCiVerifyFlags,
	rangeCommits,
	rangeMessages,
	resolveCiRange,
} from "./ci-range.ts";
import { rerunRedProofs } from "./ci-rerun.ts";
import { ciSummaryFor, isUnverifiableFinding } from "./ci-summary.ts";
import { needCommandContext } from "./command-context.ts";
import { resolveVerifyScope } from "./evaluate.ts";
import { evaluateGateScope } from "./gate-scope.ts";
import { withTrackedBugsFallback } from "./git-history.ts";
import { printFinding } from "./inspect.ts";
import type { CommandRequest } from "./shared.ts";
import { fail, portsFor, printHuman, printJson, usageError } from "./shared.ts";
import { gateVerdict } from "./verdict-emit.ts";

// SPEC §8.2 + §4.15.1: ci verify exits per §8 — 0 on allow or advise only.
// Advise findings are exactly the unverifiable ones the summary already
// separates (unreadable protection, fork read-only); anything else blocks.
export function ciVerifyExit(findings: ReadonlyArray<Finding>): number {
	return findings.some((finding) => !isUnverifiableFinding(finding)) ? 1 : 0;
}

// The verify change scope (flags, event path, commit messages) lives in
// ci-range.ts and the summary shaping in ci-summary.ts; ciVerify only
// folds its findings into the verdict.
async function ciVerify(
	req: CommandRequest,
	root: string,
	configHash: string,
	now: string,
	trailerExempt: ReadonlyArray<string>,
	engineVersion: string,
	packEntries: ReadonlyArray<{
		readonly id: string;
		readonly version?: string;
	}>,
): Promise<Result<number>> {
	const flags = parseCiVerifyFlags(req.args.slice(1));
	if (flags === undefined) {
		return usageError(
			"usage: codictator ci verify [--base <sha> --head <sha>]",
		);
	}
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const repoName = root.replaceAll("\\", "/").split("/").pop() ?? "repo";
	const workflow = renderWorkflow(repoName);
	const shallow = await ports.value.fs.exists(".git/shallow");
	const baseReachable = !(shallow.ok && shallow.value);
	// SPEC §4.15.2: the live read runs only in Actions with a token, so
	// local runs keep no protection evidence and degrade exactly as before.
	let protection: ProtectionRead | undefined;
	const inActions = ports.value.env.get("GITHUB_ACTIONS") === "true";
	const token = ports.value.env.get("GITHUB_TOKEN");
	if (inActions && token !== undefined && token !== "") {
		protection = await readProtection(ports.value.net, ports.value.env);
	}
	const checks = checkCi(
		{ trigger: "pre-tool", scope: { files: [] }, now, configHash },
		workflow,
		{
			baseReachable,
			...(protection === undefined ? {} : { protection }),
		},
	);
	// SPEC §4.3.2 + §4.15.1 + §4.7.1: L4 judges the change with the gate
	// rule subset (pre-tool plus diff-sound review, BUG-0014), so ci verify
	// also evaluates those enforcers over the change: the base..head diff
	// plus every commit message in range. Without a range there is no
	// change to judge, so the repo-wide rules judge alone, exactly as
	// before. A committed secret in range blocks here, not just at L3.
	const ranged = await resolveCiRange(ports.value, flags);
	if (!ranged.ok) {
		return fail(
			ranged.error.code,
			ranged.error.message,
			ranged.error.remediation,
			req.json,
		);
	}
	let evaluated: ReadonlyArray<Finding> = [];
	let trailered: ReadonlyArray<Finding> = [];
	// SPEC §4.10.2 + §4.12.3 L4: the red-proof re-run runs on every ranged
	// verify, PR included — there is no PR early-exit. The gate subset above
	// judges the range; the re-run below re-proves each in-range red proof.
	let rerun: ReadonlyArray<Finding> = [];
	if (ranged.value !== undefined) {
		// BUG-0014 + SPEC §4.3.2: the L4 gate judges pre-tool plus the
		// diff-sound review subset, the phase-5 finer trigger as a rule
		// subset. The diff-unsound rules (spec-trace, dead-code) stay on
		// the human `review` command over the tree; they need full-tree
		// context the range does not carry or test-title inputs, and once
		// blocked every normally-commented file.
		const scoped = await resolveVerifyScope(ports.value, {
			staged: false,
			all: false,
			base: ranged.value.base,
			head: ranged.value.head,
			layer: undefined,
		});
		if (!scoped.ok) {
			if (ciVerifyExit(checks) !== 0) {
				// SPEC §4.15.7 EC-2: the base is unreachable, which already
				// blocks via CDX-E503; the diff scope is unreachable too,
				// so the checks verdict stands instead of erroring.
			} else {
				return fail(
					scoped.error.code,
					scoped.error.message,
					scoped.error.remediation,
					req.json,
				);
			}
		} else {
			// SPEC §4.9 EC-22: a fix range stages no docs/BUGS/ file, so
			// the gate reads zero rows and fails closed on unknown-row.
			// Union the tracked BUGS rows like the hook leg before judging.
			const scopedFiles = await withTrackedBugsFallback(
				ports.value,
				scoped.value.files,
			);
			const commitText = await rangeMessages(
				ports.value,
				ranged.value.base,
				ranged.value.head,
			);
			// SPEC §4.18: the L4 gate lands its verdicts with the evaluated
			// packs and the branch task, so CI blocks reach the Timeline.
			const emit = await gateVerdict(
				ports.value,
				"ci",
				packEntries,
				engineVersion,
			);
			const judged = await evaluateGateScope(
				ports.value,
				await ciPackIds(root, engineVersion),
				commitText === ""
					? {
							files: [...scopedFiles],
							note: scoped.value.note,
						}
					: {
							files: [...scopedFiles],
							note: scoped.value.note,
							proposedContent: commitText,
						},
				now,
				configHash,
				{ emit },
			);
			if (!judged.ok) {
				return fail(
					judged.error.code,
					judged.error.message,
					judged.error.remediation,
					req.json,
				);
			}
			evaluated = judged.value;
		}
		// SPEC §4.14.2 core/no-bypass at L4: every non-merge commit in range
		// carries the Codictator-L3 trailer. An unreadable range fails
		// closed: skipping the gate would let a trailer-less commit
		// through (EC-3, EC-4).
		const commits = await rangeCommits(
			ports.value,
			ranged.value.base,
			ranged.value.head,
		);
		if (!commits.ok) {
			if (ciVerifyExit(checks) !== 0) {
				// SPEC §4.15.7 EC-2: the base is unreachable, which already
				// blocks via CDX-E503; the trailer gate is unverifiable too,
				// so its error folds into the findings verdict (ok(1))
				// instead of erroring, exactly like the diff scope above.
				trailered = [
					{
						ruleId: "core/no-bypass",
						code: commits.error.code,
						message: commits.error.message,
						remediation: commits.error.remediation,
					} satisfies Finding,
				];
			} else {
				return fail(
					commits.error.code,
					commits.error.message,
					commits.error.remediation,
					req.json,
				);
			}
		} else {
			trailered = checkCommitTrailers(commits.value, trailerExempt);
		}
		rerun = await rerunRedProofs(
			ports.value,
			root,
			ranged.value,
			checkRedProofReRun,
		);
	}
	const findings = [...checks, ...evaluated, ...trailered, ...rerun];
	const summary = ciSummaryFor(findings);
	if (req.json) {
		printJson({ findings, summary });
	} else {
		for (const finding of findings) {
			printFinding(finding, req.quiet);
		}
		if (findings.length === 0) {
			printHuman("ci verify: pass", req.quiet);
		}
		printHuman(summary, req.quiet);
	}
	return ok(ciVerifyExit(findings));
}

function ciSweep(req: CommandRequest): Result<number> {
	if (req.args.length !== 1) {
		return usageError("usage: codictator ci sweep");
	}
	const planned = planSweep({ sweepPrOpen: false, floorFindings: [] });
	if (req.json) {
		printJson(planned);
	} else {
		printHuman(`sweep ${planned.action}: ${planned.pr}`, req.quiet);
	}
	return ok(0);
}

export async function handleCi(req: CommandRequest): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "verify" && sub !== "sweep" && sub !== "record-bot-change") {
		return usageError(
			"usage: codictator ci <verify|sweep|record-bot-change ...>",
		);
	}
	const resolved = await needCommandContext(req);
	if ("ok" in resolved) {
		return resolved;
	}
	const { root, now } = resolved;
	if (sub === "verify") {
		const engineVersion = req.engineVersion ?? ENGINE_VERSION;
		const inputs = await verifyInputs(root, engineVersion);
		return ciVerify(
			req,
			root,
			inputs.configHash,
			now,
			inputs.trailerExempt,
			engineVersion,
			inputs.packEntries,
		);
	}
	if (sub === "sweep") {
		return ciSweep(req);
	}
	return ciRecordBotChange(req);
}
