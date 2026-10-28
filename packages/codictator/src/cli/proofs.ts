// SPEC §4.12.4: review rounds. Submit validates the findings file and
// verdicts it; resolve reports the still-open blockers and majors. Rounds
// bind the staged tree and the reviewer session on the task record.
import path from "node:path";
import { parseArgs } from "node:util";
import { checkReview } from "../features/workflow/index.ts";
import type { Result } from "../kernel/index.ts";
import { NodeFs, ok, parseJson } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	loadRepoConfig,
	needTaskRoot,
	portsFor,
	printHuman,
	printJson,
	readStateText,
	usageError,
} from "./shared.ts";
import { readTask, writeTask } from "./tasks.ts";

interface ReviewArgs {
	readonly file: string;
	readonly taskId: string | undefined;
}

function parseReviewArgs(req: CommandRequest): ReviewArgs | undefined {
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: { file: { type: "string" }, task: { type: "string" } },
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if ((parsed.values.file ?? "") === "") {
			return undefined;
		}
		return { file: parsed.values.file ?? "", taskId: parsed.values.task };
	} catch {
		return undefined;
	}
}

// SPEC §4.12.4: absolute --file inputs are canonicalized before the
// root-prefix comparison, so symlinked checkouts (macOS /var to
// /private/var, Windows SUBST drives) compare canonical against canonical.
// The root is already canonical via resolveRepoRoot; only the kernel
// touches node:fs (§10.3 item 3), so the input goes through NodeFs the same
// way the hook runtime's canonicalRoot does. Inputs that do not resolve
// keep their spelling and fail closed downstream as CDX-E607.
async function canonicalDir(dir: string): Promise<string> {
	const made = await NodeFs.create({ root: dir });
	if (!made.ok) {
		return dir;
	}
	const real = await made.value.realpath(".");
	if (!real.ok) {
		return dir;
	}
	return real.value;
}

async function readFindingsFile(
	root: string,
	file: string,
): Promise<string | undefined> {
	if (!path.isAbsolute(file)) {
		return readStateText(root, file);
	}
	const realRoot = await canonicalDir(root);
	const realFile = path.join(
		await canonicalDir(path.dirname(file)),
		path.basename(file),
	);
	const rel = path.relative(realRoot, realFile);
	if (
		rel === "" ||
		rel === ".." ||
		rel.startsWith(`..${path.sep}`) ||
		path.isAbsolute(rel)
	) {
		return undefined;
	}
	return readStateText(root, rel);
}

interface FindingsShape {
	readonly version: 1;
	readonly findings: unknown;
	readonly tree?: unknown;
	readonly reviewerSession?: unknown;
}

function validateFindingsFile(
	text: string,
	file: string,
	req: CommandRequest,
): FindingsShape | Result<number> {
	const parsedJson = parseJson(text);
	if (
		!parsedJson.ok ||
		typeof parsedJson.value !== "object" ||
		parsedJson.value === null
	) {
		return fail(
			"CDX-E607",
			`review findings file "${file}" is not JSON`,
			"Fix the file so it matches schema/review-findings.schema.json, then retry.",
			req.json,
		);
	}
	const shaped = parsedJson.value as {
		version?: unknown;
		findings?: unknown;
		tree?: unknown;
		reviewerSession?: unknown;
	};
	if (shaped.version !== 1 || !Array.isArray(shaped.findings)) {
		return fail(
			"CDX-E607",
			`review findings file "${file}" is invalid`,
			"Fix the file so it matches schema/review-findings.schema.json, then retry.",
			req.json,
		);
	}
	return {
		version: 1,
		findings: shaped.findings,
		tree: shaped.tree,
		reviewerSession: shaped.reviewerSession,
	};
}

async function loadFindingsShape(
	req: CommandRequest,
	root: string,
	file: string,
): Promise<FindingsShape | Result<number>> {
	const loaded = await readFindingsFile(root, file);
	if (loaded === undefined) {
		return fail(
			"CDX-E607",
			`review findings file "${file}" unreadable`,
			"Point --file at the findings JSON, then retry.",
			req.json,
		);
	}
	return validateFindingsFile(loaded, file, req);
}

function printReviewVerdict(
	req: CommandRequest,
	sub: string,
	file: string,
	verdict: ReadonlyArray<{ ruleId: string; message: string }>,
	blockers: number,
): void {
	if (req.json) {
		printJson({ file, findings: verdict.length, blockers });
		return;
	}
	for (const finding of verdict) {
		printHuman(`${finding.ruleId}  ${finding.message}`, req.quiet);
	}
	if (verdict.length === 0) {
		printHuman(
			sub === "submit" ? "review submitted: pass" : "review resolved: clean",
			req.quiet,
		);
	}
}

async function submitReviewRound(
	root: string,
	taskId: string,
	shaped: FindingsShape,
	openBlockers: number,
	openMajors: number,
	now: string,
): Promise<void> {
	const task = await readTask(root, taskId);
	if (task === undefined) {
		return;
	}
	const rounds = task.reviews ?? [];
	await writeTask(root, {
		...task,
		reviews: [
			...rounds,
			{
				round: rounds.length + 1,
				tree: typeof shaped.tree === "string" ? shaped.tree : "unknown",
				reviewerSession:
					typeof shaped.reviewerSession === "string"
						? shaped.reviewerSession
						: "cli",
				identity: "observed",
				openBlockers,
				openMajors,
				acknowledgedExceptions: [],
				at: now,
			},
		],
	});
}

// SPEC §4.12.4: review rounds bind the staged tree and the reviewer
// session; submit validates the findings file and verdicts it, resolve
// reports the still-open blockers and majors.
export async function handleReview(
	req: CommandRequest,
): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "submit" && sub !== "resolve") {
		return usageError(
			"usage: codictator review <submit|resolve> --file <path> [--task <T-####>]",
		);
	}
	const parsed = parseReviewArgs(req);
	if (parsed === undefined) {
		return usageError(
			"usage: codictator review <submit|resolve> --file <path> [--task <T-####>]",
		);
	}
	const root = await needTaskRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const shaped = await loadFindingsShape(req, root, parsed.file);
	if (!("version" in shaped)) {
		return shaped;
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
	let configHash = "unknown";
	const configured = await loadRepoConfig(root);
	if (configured.ok) {
		configHash = configured.value.effective.configHash;
	}
	const verdict = await checkReview(
		{
			trigger: "pre-tool",
			scope: { files: [] },
			now: ports.value.clock.now(),
			configHash,
		},
		shaped as never,
		{},
	);
	const blockers = verdict.filter(
		(finding) =>
			finding.ruleId === "core/review-blockers" || finding.code === "CDX-E605",
	);
	printReviewVerdict(req, sub, parsed.file, verdict, blockers.length);
	if (
		parsed.taskId !== undefined &&
		sub === "submit" &&
		blockers.length === 0
	) {
		await submitReviewRound(
			root,
			parsed.taskId,
			shaped,
			0,
			0,
			ports.value.clock.now(),
		);
	}
	return verdict.length === 0 ? ok(0) : ok(1);
}
