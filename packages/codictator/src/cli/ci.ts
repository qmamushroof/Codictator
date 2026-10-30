// SPEC §4.15: CI verify, sweep and bot-change recording. Verify fails
// closed on an unreachable base (CDX-E503) and advises where protection
// reads are unavailable; sweep plans the single codictator/sweep PR.
import { parseArgs } from "node:util";
import {
	checkCi,
	type ProtectionRead,
	planSweep,
	qualifyBotChange,
	readProtection,
	renderWorkflow,
} from "../features/ci/index.ts";
import type { Finding, Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import {
	ciPackIds,
	parseCiVerifyFlags,
	rangeMessages,
	resolveCiRange,
} from "./ci-range.ts";
import { ciSummaryFor, isUnverifiableFinding } from "./ci-summary.ts";
import { evaluateScope, resolveVerifyScope } from "./evaluate.ts";
import { printFinding } from "./inspect.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	loadRepoConfig,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";

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
	// SPEC §4.3.2 + §4.15.1 + §4.7.1: L4 is a superset of every local
	// layer, so ci verify also evaluates the enforcers over the change:
	// the base..head diff plus every commit message in range. Without a
	// range there is no change to judge, so the repo-wide rules judge
	// alone, exactly as before. A committed secret in range blocks here,
	// not just at L3.
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
	if (ranged.value !== undefined) {
		const scoped = await resolveVerifyScope(ports.value, {
			staged: false,
			all: false,
			base: ranged.value.base,
			head: ranged.value.head,
			layer: "L4",
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
			const commitText = await rangeMessages(
				ports.value,
				ranged.value.base,
				ranged.value.head,
			);
			const judged = await evaluateScope(
				ports.value,
				await ciPackIds(root),
				commitText === ""
					? scoped.value
					: { ...scoped.value, proposedContent: commitText },
				now,
				configHash,
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
	}
	const findings = [...checks, ...evaluated];
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

interface BotChangeFlags {
	readonly author: string;
	readonly files: ReadonlyArray<string>;
	readonly fork: boolean;
}

function parseRecordFlags(req: CommandRequest): BotChangeFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: {
				author: { type: "string" },
				files: { type: "string", multiple: true, default: [] },
				fork: { type: "boolean", default: false },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if (
			(parsed.values.author ?? "") === "" ||
			(parsed.values.files ?? []).length === 0
		) {
			return undefined;
		}
		return {
			author: parsed.values.author ?? "",
			files: [...(parsed.values.files ?? [])],
			fork: parsed.values.fork ?? false,
		};
	} catch {
		return undefined;
	}
}

function ciRecordBotChange(req: CommandRequest): Result<number> {
	const flags = parseRecordFlags(req);
	if (flags === undefined) {
		return usageError(
			"usage: codictator ci record-bot-change --author <bot> --files <f> ... [--fork]",
		);
	}
	const planned = qualifyBotChange({
		author: flags.author,
		filesChanged: flags.files,
		isFork: flags.fork,
		trailerExempt: [],
	});
	if (req.json) {
		printJson(planned);
	} else {
		printHuman(
			`bot change qualifies: ${planned.qualifies}, write commit: ${planned.writeCommit}`,
			req.quiet,
		);
	}
	return planned.findings.length === 0 ? ok(0) : ok(1);
}

export async function handleCi(req: CommandRequest): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "verify" && sub !== "sweep" && sub !== "record-bot-change") {
		return usageError(
			"usage: codictator ci <verify|sweep|record-bot-change ...>",
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
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
	const now = ports.value.clock.now();
	if (sub === "verify") {
		let configHash = "unknown";
		const configured = await loadRepoConfig(root);
		if (configured.ok) {
			configHash = configured.value.effective.configHash;
		}
		return ciVerify(req, root, configHash, now);
	}
	if (sub === "sweep") {
		return ciSweep(req);
	}
	return ciRecordBotChange(req);
}
