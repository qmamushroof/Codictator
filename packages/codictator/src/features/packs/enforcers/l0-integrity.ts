// SPEC §4.14.2 L0: core/guardrail-manifest, core/hooks-active and
// core/engine-version-match also judge the live repo at session start, not
// only fixture marker reports. The one drift check (integrity checkDrift)
// runs over a snapshot built from the root-confined ports, and each rule
// keeps its own findings. Without a manifest there is nothing to compare
// artifacts against, so only the hook and engine legs judge (the CLI drift
// reports the same case as unverified). Artifacts in `entries` mode need
// the adapter's owned-entry projection (§4.14.1), which a rule cannot make,
// so they stay with `codictator verify`.
import type { Ports, Result } from "../../../kernel/index.ts";
import { normalizeText, ok, parseJson } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import {
	checkDrift,
	EXPECTED_HOOKS_PATH,
	type FileContent,
	type GuardrailManifest,
	type InstalledHook,
	manifestHash,
} from "../../integrity/index.ts";
import type { PackRule } from "../index.ts";

const MANIFEST = ".codictator/manifest.json";

async function jsonOf(
	ports: Ports,
	path: string,
): Promise<{ codictator?: unknown } | undefined> {
	const seen = await ports.fs.exists(path);
	const text =
		seen.ok && seen.value ? await ports.fs.readText(path) : undefined;
	const parsed = text?.ok === true ? parseJson(text.value) : undefined;
	return parsed?.ok === true &&
		typeof parsed.value === "object" &&
		parsed.value !== null
		? (parsed.value as { codictator?: unknown })
		: undefined;
}

async function artifactFiles(
	ports: Ports,
	manifest: GuardrailManifest,
): Promise<Array<FileContent>> {
	const files: Array<FileContent> = [];
	for (const artifact of manifest.artifacts) {
		const text =
			artifact.mode === "entries"
				? undefined
				: await ports.fs.readText(artifact.path);
		if (text?.ok === true) {
			files.push({ path: artifact.path, content: normalizeText(text.value) });
		}
	}
	return files;
}

async function installedHooks(ports: Ports): Promise<Array<InstalledHook>> {
	const listed = await ports.fs.list(EXPECTED_HOOKS_PATH);
	return (listed.ok ? listed.value : []).map((name) => ({
		name,
		executable: true,
	}));
}

// The drift findings of the live repo at session start, all three rules.
async function l0Findings(
	ports: Ports,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const config = await jsonOf(ports, ".codictator/config.json");
	const pinned =
		typeof config?.codictator === "string" ? config.codictator : "";
	const recorded = await jsonOf(ports, MANIFEST);
	const manifest = (recorded ?? {
		version: 1,
		codictator: pinned,
		artifacts: [],
		hash: manifestHash([]),
	}) as unknown as GuardrailManifest;
	const hooksPath = await ports.git.config("core.hooksPath");
	return checkDrift(ctx, manifest, {
		files: await artifactFiles(ports, manifest),
		...(hooksPath.ok ? { hooksPath: hooksPath.value.trim() } : {}),
		installedHooks: await installedHooks(ports),
		engineVersion: pinned,
	});
}

// The marker resolver answers fixtures at every trigger; the live check adds
// the repo's own findings at the session-start trigger only, whose hook scope
// carries no disk files (a self-test scope lists its fixture files).
export function withLiveStart(
	base: Result<Enforcer>,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	if (!base.ok) {
		return base;
	}
	const inner = base.value;
	return ok({
		...inner,
		check: async (ctx, params) => {
			const own = await inner.check(ctx, params);
			if (ctx.trigger !== "startup" || ctx.scope.files.length > 0) {
				return own;
			}
			const live = await l0Findings(ports, ctx);
			return [...own, ...live.filter((found) => found.ruleId === rule.id)];
		},
	});
}
