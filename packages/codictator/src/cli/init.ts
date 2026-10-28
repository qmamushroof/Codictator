// SPEC §4.19.2 + §4.13.1: human-only adoption. Writes config, steering
// block, manifest, CI workflow, hooks and launcher; existing config needs
// --repair, unknown harnesses fail as CDX-E301 via validation.
import { parseArgs } from "node:util";
import type { Result } from "../kernel/index.ts";
import { ok, resolveRepoRoot } from "../kernel/index.ts";
import { guardrailPlan, writePlan } from "./plan.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
	fail,
	loadRepoConfig,
	printHuman,
	printJson,
	readStateText,
	usageError,
} from "./shared.ts";

// SPEC §4.19.2: init harnesses default to every known adapter id when no
// --harness flag is given; unknown ids fail as CDX-E301 via config
// validation, never silently.
const DEFAULT_HARNESSES: ReadonlyArray<string> = [
	"muse-code",
	"universal",
	"claude-code",
	"copilot",
	"codex-cli",
	"cursor",
	"gemini-cli",
	"opencode",
];

const KNOWN_PROFILES: ReadonlySet<string> = new Set([
	"app",
	"library",
	"cli",
	"service",
]);

interface InitFlags {
	readonly harnesses: Array<string>;
	readonly profile: string;
	readonly repair: boolean;
}

function parseInitFlags(args: ReadonlyArray<string>): InitFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {
				harness: { type: "string", multiple: true, default: [] },
				profile: { type: "string", default: "" },
				repair: { type: "boolean", default: false },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if (
			parsed.values.profile !== undefined &&
			parsed.values.profile !== "" &&
			!KNOWN_PROFILES.has(parsed.values.profile)
		) {
			return undefined;
		}
		return {
			harnesses: [...(parsed.values.harness ?? [])],
			profile: parsed.values.profile ?? "",
			repair: parsed.values.repair ?? false,
		};
	} catch {
		return undefined;
	}
}

const INIT_USAGE =
	"usage: codictator init [--harness <id> ...] [--profile <app|library|cli|service>] [--repair]";

function defaultHarnesses(flags: InitFlags): Array<string> {
	return flags.harnesses.length > 0 ? flags.harnesses : [...DEFAULT_HARNESSES];
}

function reportExisting(req: CommandRequest, root: string): Result<number> {
	printHuman(
		"already a Codictator repo; rerun with --repair to regenerate",
		req.quiet,
	);
	if (req.json) {
		printJson({ initialized: false, reason: "exists", root });
	}
	return ok(0);
}

async function checkFreshConfig(
	root: string,
	req: CommandRequest,
): Promise<Result<number>> {
	const fresh = await loadRepoConfig(root);
	if (!fresh.ok) {
		return fail(
			"CDX-E901",
			fresh.error.message,
			"Rerun codictator init --repair; report the mismatch.",
			req.json,
			fresh.error.detail,
		);
	}
	return ok(0);
}

function emitInitResult(
	req: CommandRequest,
	root: string,
	written: ReadonlyArray<{ path: string }>,
): Result<number> {
	if (req.json) {
		printJson({
			initialized: true,
			root,
			files: written.map((entry) => entry.path),
		});
	} else {
		for (const entry of written) {
			printHuman(`wrote ${entry.path}`, req.quiet);
		}
		printHuman("init: run npm ci, then codictator install-hooks", req.quiet);
	}
	return ok(0);
}

async function initPreamble(
	req: CommandRequest,
): Promise<string | Result<number>> {
	const human = checkHuman(commandEnv(), []);
	if (!human.ok) {
		return fail(
			"CDX-E107",
			human.error.message,
			human.error.remediation,
			req.json,
		);
	}
	const root = await resolveRepoRoot(req.cwd);
	if (!root.ok) {
		return fail(
			"CDX-E703",
			root.error.message,
			root.error.remediation,
			req.json,
		);
	}
	return root.value;
}

export async function handleInit(req: CommandRequest): Promise<Result<number>> {
	const flags = parseInitFlags(req.args);
	if (flags === undefined) {
		return usageError(INIT_USAGE);
	}
	const root = await initPreamble(req);
	if (typeof root !== "string") {
		return root;
	}
	const planned = defaultHarnesses(flags);
	const existing = await readStateText(root, ".codictator/config.json");
	if (existing !== undefined && !flags.repair) {
		return reportExisting(req, root);
	}
	const agents = await readStateText(root, "AGENTS.md");
	const repoName = root.replaceAll("\\", "/").split("/").pop() ?? "repo";
	const wrote = await writePlan(
		root,
		guardrailPlan(planned, flags.profile, repoName, agents),
	);
	if (!wrote.ok) {
		return fail(
			"CDX-E903",
			wrote.error.message,
			wrote.error.remediation,
			req.json,
		);
	}
	const fresh = await checkFreshConfig(root, req);
	if (!fresh.ok) {
		return fresh;
	}
	return emitInitResult(req, root, wrote.value);
}
