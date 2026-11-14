// SPEC §4.19.2 + §4.3.3: trigger evaluation for `verify`. Resolves the
// scope from the verify flags, loads the always-on core pack plus the
// builtin language packs config packs name, and runs the engine over the
// scope. Findings merge with the drift findings in inspect.ts; pack load
// failures fail closed with their own code. Custom packs stay out until
// their acceptance flow lands (core/custom-pack-selftest is red).

import {
	createEngine,
	MAX_WAIVER_DAYS,
	readWaiverFile,
	type WaiverStore,
} from "../features/engine/index.ts";
import {
	isBuiltinPackId,
	loadBuiltinPack,
	resolveManifestEnforcers,
} from "../features/packs/index.ts";
import type {
	Enforcer,
	Finding,
	Ports,
	Result,
	Trigger,
} from "../kernel/index.ts";
import { err, ok, withoutPackCases } from "../kernel/index.ts";
import { sharedReads } from "./evaluate-cache.ts";
import type { CommandPorts } from "./shared.ts";
import { type EvaluateOptions, emitEngineOptions } from "./verdict-emit.ts";
import { applyWaiverParams } from "./waiver-params.ts";

export interface VerifyScope {
	readonly trigger: Trigger;
	readonly files: ReadonlyArray<string>;
	readonly note: string;
	// SPEC §4.7.1: hook and CI scopes judge content that is not (only) on
	// disk — the staged diff, the pushed diff, the commit messages in range.
	// It rides the same redactSecrets scan as files via the tool-input path.
	readonly proposedContent?: string;
}

// SPEC §4.3.2: the layer flag selects the trigger family. L1 and L2 are
// the local gate (pre-tool); L3 and above review the change as CI would.
export function triggerForLayer(layer: string | undefined): Trigger {
	return layer === "L3" || layer === "L4" || layer === "L5"
		? "review"
		: "pre-tool";
}

function sortedUnique(files: ReadonlyArray<string>): Array<string> {
	return [...new Set(files)].sort();
}

function splitLines(output: string): Array<string> {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

async function runGitList(
	ports: CommandPorts,
	argv: ReadonlyArray<string>,
): Promise<Result<Array<string>>> {
	const ran = await ports.proc.run(argv, {
		cwd: ports.root,
		env: {},
		timeoutMs: 30000,
		maxOutputBytes: 8 * 1024 * 1024,
	});
	if (ran.timedOut || ran.truncated || ran.code !== 0) {
		return err({
			code: "CDX-E703",
			message: `git ${argv[1] ?? ""} failed while resolving the verify scope`,
			remediation: "Run inside a git repository with git on PATH.",
		});
	}
	return { ok: true, value: splitLines(ran.stdout) };
}

// SPEC §4.19.2: --staged evaluates the staged tree, --base/--head the
// range, --all and the bare command the tracked tree plus staged edits.
// SPEC §4.4.1 pack case data: a committed violating case would flag on every
// run and can never be "fixed" without breaking the self-test, so every scope
// here drops pack case paths only; fixtureGlobs never narrows a scope.
export async function resolveVerifyScope(
	ports: CommandPorts,
	flags: {
		readonly staged: boolean;
		readonly all: boolean;
		readonly base: string | undefined;
		readonly head: string | undefined;
		readonly layer: string | undefined;
	},
): Promise<Result<VerifyScope>> {
	const trigger = triggerForLayer(flags.layer);
	if (flags.staged) {
		const staged = await ports.git.stagedFiles();
		if (!staged.ok) {
			return err(staged.error);
		}
		const files = withoutPackCases(staged.value, ports.packRoots ?? []);
		return ok({
			trigger,
			files,
			note: `staged ${String(files.length)} files`,
		});
	}
	if (flags.base !== undefined && flags.head !== undefined) {
		// BUG-0044 ACMR only: a ranged deletion has no worktree content, so
		// listing it fail-closes the gate (same class as BUG-0041/0043).
		const ranged = await runGitList(ports, [
			"git",
			"diff",
			"--name-only",
			"--diff-filter=ACMR",
			flags.base,
			flags.head,
		]);
		if (!ranged.ok) {
			return err(ranged.error);
		}
		const files = withoutPackCases(ranged.value, ports.packRoots ?? []);
		return ok({
			trigger,
			files,
			note: `range ${flags.base}..${flags.head}`,
		});
	}
	const tracked = await runGitList(ports, ["git", "ls-files"]);
	if (!tracked.ok) {
		return err(tracked.error);
	}
	const staged = await ports.git.stagedFiles();
	if (!staged.ok) {
		return err(staged.error);
	}
	return ok({
		trigger,
		files: sortedUnique(
			withoutPackCases(
				[...tracked.value, ...staged.value],
				ports.packRoots ?? [],
			),
		),
		note: "tracked tree",
	});
}

// SPEC §4.3.6: one verify evaluation reads each scope file once. The
// memo lives in evaluate-cache.ts; every scope here runs over it.

// SPEC §4.4.2: the core pack is always loaded; language packs join from
// config.packs order. A config that names core does not load it twice.
// Every pack resolves against the caller's ports; the verify caller shares
// one read cache across them, so scope files read repo-relatively (§4.1.1)
// exactly once per run.
export async function loadEvalEnforcers(
	ports: Ports,
	packIds: ReadonlyArray<string>,
	excludeRuleIds: ReadonlySet<string> = new Set(),
): Promise<
	Result<{
		readonly enforcers: Array<Enforcer>;
		readonly waiverStore: WaiverStore;
	}>
> {
	const core = await loadBuiltinPack("core");
	if (!core.ok) {
		return err(core.error);
	}
	const manifests = [core.value.manifest];
	for (const id of packIds) {
		if (id === "core" || !isBuiltinPackId(id)) {
			continue;
		}
		const loaded = await loadBuiltinPack(id);
		if (!loaded.ok) {
			return err(loaded.error);
		}
		manifests.push(loaded.value.manifest);
	}
	// SPEC §4.2.1 step 4 + §4.3.3 step 3: the file waivers loosen the
	// resolved params and ride the engines for suppression. Tiers come
	// from the evaluated manifests, so an unknown tier fails closed.
	const now = ports.clock.now();
	const tiers: Record<string, "floor" | "tunable"> = {};
	for (const manifest of manifests) {
		for (const rule of manifest.rules) {
			tiers[rule.id] = rule.tier === "tunable" ? "tunable" : "floor";
		}
	}
	const days = core.value.manifest.maxWaiverDays;
	const waiverStore: WaiverStore = {
		waivers: await readWaiverFile(ports.fs),
		tiers,
		maxWaiverDays:
			typeof days === "number" && Number.isFinite(days) && days > 0
				? days
				: MAX_WAIVER_DAYS,
	};
	const enforcers: Array<Enforcer> = [];
	for (const manifest of manifests) {
		const resolved = resolveManifestEnforcers(
			applyWaiverParams(manifest, waiverStore, now),
			ports,
		);
		if (!resolved.ok) {
			return err(resolved.error);
		}
		enforcers.push(...resolved.value);
	}
	return ok({
		enforcers: enforcers.filter((enforcer) => !excludeRuleIds.has(enforcer.id)),
		waiverStore,
	});
}

export async function evaluateScope(
	ports: CommandPorts,
	packIds: ReadonlyArray<string>,
	scope: VerifyScope,
	now: string,
	configHash: string,
	// BUG-0014: diff-scope callers pass the diff-unsound rule ids (the gate
	// subset); tree callers omit it and judge everything.
	options: EvaluateOptions = {},
): Promise<Result<Array<Finding>>> {
	const cached: CommandPorts = { ...ports, fs: sharedReads(ports.fs) };
	const excluded: ReadonlySet<string> = options.excludeRuleIds ?? new Set();
	const loaded = await loadEvalEnforcers(cached, packIds, excluded);
	if (!loaded.ok) {
		return err(loaded.error);
	}
	const engineOptions = {
		...emitEngineOptions(configHash, options.emit),
		waiverStore: loaded.value.waiverStore,
	};
	const engine = createEngine(loaded.value.enforcers, engineOptions);
	const verdict = await engine.evaluate(
		scope.trigger,
		{
			files: [...scope.files],
			...(scope.proposedContent === undefined || scope.proposedContent === ""
				? {}
				: { proposedContent: scope.proposedContent }),
		},
		now,
	);
	return ok([...verdict.findings]);
}
