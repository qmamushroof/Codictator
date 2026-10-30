// SPEC §4.13.1 + §4.14.1: init execution. Split from the init command
// (init.ts) by responsibility: flag parsing stays on the command, module
// detection, baseline, guards and plan assembly live here.
import { CODICTATOR_MODULES, type ModuleNode } from "../features/arch/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { captureBaseline } from "../features/remediation/index.ts";
import type { Result } from "../kernel/index.ts";
import {
	ok,
	parseJson,
	resolveRepoRoot,
	stableStringify,
} from "../kernel/index.ts";
import { buildHelperTool, guardrailPlan } from "./plan.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
	fail,
	loadRepoConfig,
	printHuman,
	printJson,
	readStateText,
	writeStateText,
} from "./shared.ts";

export interface InitFlags {
	readonly harnesses: Array<string>;
	readonly profile: string;
	readonly packs: Array<string>;
	readonly tools: Array<{ role: string; command: string; pin: string }>;
	readonly repair: boolean;
}

// SPEC §4.19.2: a helper tool proposal names the helper role, the binary
// and the exact pin from the human's registry lookup: role=command@pin.

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// SPEC §4.11.2 + §3.3: on the Codictator repo itself, init proposes the
// canonical module map the arch guard dogfoods (profiles.ts), rewritten to
// repo-relative paths. Any other repo gets no modules; the human adds them.
async function detectCodictatorModules(
	root: string,
): Promise<ReadonlyArray<ModuleNode> | undefined> {
	const text = await readStateText(root, "packages/codictator/package.json");
	if (text === undefined) {
		return undefined;
	}
	const parsed = parseJson(text);
	if (!parsed.ok || !isRecord(parsed.value)) {
		return undefined;
	}
	const nameKey = "name";
	if (parsed.value[nameKey] !== "codictator") {
		return undefined;
	}
	return CODICTATOR_MODULES.map((mod) => ({
		name: mod.name,
		path: `packages/codictator/${mod.path}`,
		...(mod.kind === undefined ? {} : { kind: mod.kind }),
		...(mod.entry === undefined ? {} : { entry: mod.entry }),
		dependsOn: [...mod.dependsOn],
	}));
}
// SPEC §4.13.1 step 3: init captures the baseline. On a greenfield repo the
// first verify has no findings, so the capture is the empty ratchet. An
// existing baseline (repair, L3 tighten, capture) is never overwritten.
export async function ensureBaseline(
	root: string,
	req: CommandRequest,
): Promise<Result<boolean>> {
	const existing = await readStateText(root, ".codictator/baseline.json");
	if (existing !== undefined) {
		return ok(false);
	}
	const captured = await captureBaseline(root, []);
	if (!captured.ok) {
		return fail(
			"CDX-E903",
			captured.error.message,
			captured.error.remediation,
			req.json,
		);
	}
	const saved = await writeStateText(
		root,
		".codictator/baseline.json",
		`${stableStringify(captured.value)}\n`,
	);
	if (!saved.ok) {
		return fail(
			"CDX-E903",
			saved.error.message,
			saved.error.remediation,
			req.json,
		);
	}
	return ok(true);
}
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
export function defaultHarnesses(flags: InitFlags): Array<string> {
	return flags.harnesses.length > 0 ? flags.harnesses : [...DEFAULT_HARNESSES];
}
export function reportExisting(
	req: CommandRequest,
	root: string,
): Result<number> {
	printHuman(
		"already a Codictator repo; rerun with --repair to regenerate",
		req.quiet,
	);
	if (req.json) {
		printJson({ initialized: false, reason: "exists", root });
	}
	return ok(0);
}
export async function checkFreshConfig(
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
export function emitInitResult(
	req: CommandRequest,
	root: string,
	written: ReadonlyArray<{ path: string }>,
	baselineWritten: boolean,
): Result<number> {
	const files =
		baselineWritten === false
			? written
			: [...written, { path: ".codictator/baseline.json" }];
	if (req.json) {
		printJson({
			initialized: true,
			root,
			files: files.map((entry) => entry.path),
		});
	} else {
		for (const entry of files) {
			printHuman(`wrote ${entry.path}`, req.quiet);
		}
		printHuman("init: run npm ci, then codictator install-hooks", req.quiet);
	}
	return ok(0);
}
export async function initPreamble(
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

// The plan assembly handleInit writes: read-only inputs in, GuardrailPlan
// out. Writing stays on the command so the plan builder never touches
// the disk.
export async function buildGuardrailPlan(
	root: string,
	flags: InitFlags,
	planned: ReadonlyArray<string>,
): Promise<ReturnType<typeof guardrailPlan>> {
	const agents = await readStateText(root, "AGENTS.md");
	const repoName = root.replaceAll("\\", "/").split("/").pop() ?? "repo";
	const modules = await detectCodictatorModules(root);
	const architecture =
		modules === undefined
			? undefined
			: {
					...(flags.profile === "" ? {} : { profile: flags.profile }),
					modules,
				};
	return guardrailPlan(planned, flags.profile, repoName, agents, {
		packs: flags.packs.map((id) => ({ id, version: ENGINE_VERSION })),
		tools: flags.tools.map((tool) => buildHelperTool(tool)),
		...(architecture === undefined ? {} : { architecture }),
	});
}
