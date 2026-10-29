// SPEC §4.14.1 + §4.14.5: guardrail plan builders. The file list (config,
// steering block, CI workflow, hooks, launcher) and the manifest write are
// shared by init and regen, so regeneration stays byte-identical.
import { renderWorkflow } from "../features/ci/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import {
	buildManifest,
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
	hookInstallPlan,
	renderHookScript,
} from "../features/integrity/index.ts";
import {
	buildManagedBlock,
	MANAGED_BEGIN,
	MANAGED_END,
} from "../features/steering/index.ts";
import type { Result } from "../kernel/index.ts";
import {
	err,
	normalizeText,
	ok,
	sha256Text,
	stableStringify,
} from "../kernel/index.ts";
import { LAUNCHER_TEXT } from "./plan-launcher.ts";
import { portsFor } from "./shared.ts";

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

// SPEC §4.4.5 + §4.6.6: init proposals for helper tools. The entry carries
// the role, the binary, the exact pin from the human's registry lookup, and
// a probe matching any semver in the tool's --version output whose capture
// must equal the pin (external-probe.ts). Helpers never back enforcers, so
// the probe runs only when a pack binds the tool.
export const KNOWN_HELPER_ROLES: ReadonlySet<string> = new Set([
	"knowledge-graph",
	"token-saver",
	"dependency-bot",
	"other",
]);

const SEMVER_CAPTURE = "(\\d+\\.\\d+\\.\\d+)";

export interface HelperProposal {
	readonly role: string;
	readonly command: string;
	readonly pin: string;
}

export function buildHelperTool(
	proposal: HelperProposal,
): Record<string, unknown> {
	return {
		id: proposal.command,
		command: [proposal.command],
		version: {
			pin: proposal.pin,
			probe: [proposal.command, "--version"],
			pattern: SEMVER_CAPTURE,
		},
		role: proposal.role,
	};
}

function configText(
	harnesses: ReadonlyArray<string>,
	profile: string,
	extras: PlanExtras = {},
): string {
	const sorted = [...harnesses].sort();
	const architecture =
		extras.architecture ?? (profile === "" ? undefined : { profile });
	const config: Record<string, unknown> = {
		version: 1,
		codictator: ENGINE_VERSION,
		packs: extras.packs ?? [],
		harnesses: sorted,
		tunables: extras.tunables ?? {},
		...(architecture === undefined ? {} : { architecture }),
		...(extras.tools === undefined ? {} : { tools: extras.tools }),
	};
	return `${stableStringify(config)}\n`;
}

// SPEC §4.14.1: user text outside the managed block survives regen; a
// malformed block is replaced rather than duplicated (CDX-E501 avoided).
function withManagedBlock(existing: string | undefined): string {
	const block = buildManagedBlock();
	if (existing === undefined) {
		return `${block}\n`;
	}
	const start = existing.indexOf(MANAGED_BEGIN);
	const end = existing.indexOf(MANAGED_END);
	if (start < 0 || end < 0 || end < start) {
		const trimmed = existing.endsWith("\n") ? existing : `${existing}\n`;
		return `${trimmed}\n${block}\n`;
	}
	const after = end + MANAGED_END.length;
	return `${existing.slice(0, start)}${block}${existing.slice(after)}`;
}

export interface GuardrailPlan {
	readonly files: ReadonlyArray<{ path: string; content: string }>;
}

// SPEC §4.14.5 + §4.19.2: init and regen carry the generator-owned config
// sections through the plan, so regeneration preserves packs, tunables,
// the architecture map and helper tools instead of dropping them. Values
// are written verbatim (stableStringify is canonical), keeping regen
// byte-identical on unchanged config.
export interface PlanExtras {
	readonly packs?: unknown;
	readonly tunables?: unknown;
	readonly architecture?: unknown;
	readonly tools?: unknown;
}

export function guardrailPlan(
	harnesses: ReadonlyArray<string>,
	profile: string,
	repoName: string,
	existingAgents: string | undefined,
	extras: PlanExtras = {},
): GuardrailPlan {
	const files: Array<{ path: string; content: string }> = [];
	files.push({
		path: ".codictator/config.json",
		content: configText(harnesses, profile, extras),
	});
	files.push({ path: "AGENTS.md", content: withManagedBlock(existingAgents) });
	const workflow = renderWorkflow(repoName);
	files.push({
		path: ".github/workflows/codictator.yml",
		content: workflow.text ?? "",
	});
	for (const hook of HOOK_NAMES) {
		files.push({
			path: `${EXPECTED_HOOKS_PATH}/${hook}`,
			content: renderHookScript(hook),
		});
	}
	const plan = hookInstallPlan({});
	files.push({
		path: `${EXPECTED_HOOKS_PATH}/.gitattributes`,
		content: plan.gitattributes,
	});
	files.push({ path: ".codictator/bin/run.mjs", content: LAUNCHER_TEXT });
	return { files };
}

export async function writePlan(
	root: string,
	plan: GuardrailPlan,
): Promise<Result<Array<{ path: string; hash: string }>>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	const written: Array<{ path: string; hash: string }> = [];
	for (const file of plan.files) {
		const done = await ports.value.fs.write(file.path, encode(file.content));
		if (!done.ok) {
			return err(done.error);
		}
		written.push({
			path: file.path,
			hash: sha256Text(normalizeText(file.content)),
		});
	}
	const manifest = buildManifest(
		ENGINE_VERSION,
		written.map((entry) => ({
			path: entry.path,
			owner: "codictator",
			mode: "file" as const,
			hash: entry.hash,
		})),
	);
	const saved = await ports.value.fs.write(
		".codictator/manifest.json",
		encode(`${stableStringify(manifest)}\n`),
	);
	if (!saved.ok) {
		return err(saved.error);
	}
	return ok(written);
}
