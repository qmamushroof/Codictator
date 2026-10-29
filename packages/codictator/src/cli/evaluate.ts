// SPEC §4.19.2 + §4.3.3: trigger evaluation for `verify`. Resolves the
// scope from the verify flags, loads the always-on core pack plus the
// builtin language packs config packs name, and runs the engine over the
// scope. Findings merge with the drift findings in inspect.ts; pack load
// failures fail closed with their own code. Custom packs stay out until
// their acceptance flow lands (core/custom-pack-selftest is red).

import { createEngine } from "../features/engine/index.ts";
import {
	isBuiltinPackId,
	loadBuiltinPack,
	resolveManifestEnforcers,
} from "../features/packs/index.ts";
import type { Enforcer, Finding, Result, Trigger } from "../kernel/index.ts";
import { err, ok } from "../kernel/index.ts";
import type { CommandPorts } from "./shared.ts";

export interface VerifyScope {
	readonly trigger: Trigger;
	readonly files: ReadonlyArray<string>;
	readonly note: string;
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
		return ok({
			trigger,
			files: staged.value,
			note: `staged ${String(staged.value.length)} files`,
		});
	}
	if (flags.base !== undefined && flags.head !== undefined) {
		const ranged = await runGitList(ports, [
			"git",
			"diff",
			"--name-only",
			flags.base,
			flags.head,
		]);
		if (!ranged.ok) {
			return err(ranged.error);
		}
		return ok({
			trigger,
			files: ranged.value,
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
		files: sortedUnique([...tracked.value, ...staged.value]),
		note: "tracked tree",
	});
}

// SPEC §4.4.2: the core pack is always loaded; language packs join from
// config.packs order. Every pack resolves against the root-confined ports
// so scope files read repo-relatively (§4.1.1).
export async function evaluateScope(
	ports: CommandPorts,
	packIds: ReadonlyArray<string>,
	scope: VerifyScope,
	now: string,
	configHash: string,
): Promise<Result<Array<Finding>>> {
	const core = await loadBuiltinPack("core");
	if (!core.ok) {
		return err(core.error);
	}
	const manifests = [core.value.manifest];
	for (const id of packIds) {
		if (!isBuiltinPackId(id)) {
			continue;
		}
		const loaded = await loadBuiltinPack(id);
		if (!loaded.ok) {
			return err(loaded.error);
		}
		manifests.push(loaded.value.manifest);
	}
	const enforcers: Array<Enforcer> = [];
	for (const manifest of manifests) {
		const resolved = resolveManifestEnforcers(manifest, ports);
		if (!resolved.ok) {
			return err(resolved.error);
		}
		enforcers.push(...resolved.value);
	}
	const engine = createEngine(enforcers, { configHash });
	const verdict = await engine.evaluate(
		scope.trigger,
		{ files: [...scope.files] },
		now,
	);
	return ok([...verdict.findings]);
}
