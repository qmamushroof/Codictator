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
import type {
	Enforcer,
	Finding,
	Fs,
	Result,
	Trigger,
} from "../kernel/index.ts";
import { err, isFixturePath, ok } from "../kernel/index.ts";
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
// SPEC §4.4.1 + §10.2: pack self-test fixtures are rule test data, judged
// by `pack test` and the red suite, not by verify. A committed violating
// fixture would flag on every run and can never be "fixed" without breaking
// the self-test, so every scope here excludes fixture dirs.
function withoutFixtures(files: ReadonlyArray<string>): Array<string> {
	return files.filter((file) => !isFixturePath(file));
}

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
		const files = withoutFixtures(staged.value);
		return ok({
			trigger,
			files,
			note: `staged ${String(files.length)} files`,
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
		const files = withoutFixtures(ranged.value);
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
		files: sortedUnique(withoutFixtures([...tracked.value, ...staged.value])),
		note: "tracked tree",
	});
}

// SPEC §4.3.6: one verify evaluation reads each scope file once. Enforcers
// close over the same ports, so without sharing a full-tree scope costs one
// sweep per enforcer and every guard exceeds its budget under disk
// contention. This memo shares in-flight and completed reads across the
// evaluation; writes, appends and removals invalidate the path. Results are
// copies, so a guard can never mutate another guard's bytes.
function sharedRead(
	inner: Fs,
	reads: Map<string, Promise<Result<Uint8Array>>>,
): Fs["read"] {
	return (path: string): Promise<Result<Uint8Array>> => {
		const hit = reads.get(path);
		if (hit !== undefined) {
			return hit.then((result) =>
				result.ok ? { ok: true as const, value: result.value.slice() } : result,
			);
		}
		const pending = inner.read(path);
		reads.set(path, pending);
		return pending.then((result) =>
			result.ok ? { ok: true as const, value: result.value.slice() } : result,
		);
	};
}

function sharedReadText(
	inner: Fs,
	texts: Map<string, Promise<Result<string>>>,
): Fs["readText"] {
	return (path: string): Promise<Result<string>> => {
		const hit = texts.get(path);
		if (hit !== undefined) {
			return hit;
		}
		const pending = inner.readText(path);
		texts.set(path, pending);
		return pending;
	};
}

function sharedRealpath(
	inner: Fs,
	reals: Map<string, Promise<Result<string>>>,
): Fs["realpath"] {
	return (path: string): Promise<Result<string>> => {
		const hit = reals.get(path);
		if (hit !== undefined) {
			return hit;
		}
		const pending = inner.realpath(path);
		reals.set(path, pending);
		return pending;
	};
}

function sharedReads(inner: Fs): Fs {
	const reads = new Map<string, Promise<Result<Uint8Array>>>();
	const texts = new Map<string, Promise<Result<string>>>();
	const reals = new Map<string, Promise<Result<string>>>();
	const drop = (path: string): void => {
		reads.delete(path);
		texts.delete(path);
		reals.delete(path);
	};
	const invalidate = <T>(
		done: Promise<Result<T>>,
		path: string,
	): Promise<Result<T>> =>
		done.then((result) => {
			if (result.ok) {
				drop(path);
			}
			return result;
		});
	return {
		read: sharedRead(inner, reads),
		readText: sharedReadText(inner, texts),
		write: (path: string, content: Uint8Array): Promise<Result<void>> =>
			invalidate(inner.write(path, content), path),
		append: (path: string, content: Uint8Array): Promise<Result<void>> =>
			invalidate(inner.append(path, content), path),
		remove: (path: string): Promise<Result<void>> =>
			invalidate(inner.remove(path), path),
		stat: (path: string) => inner.stat(path),
		list: (dir: string) => inner.list(dir),
		glob: (pattern: string, dir: string) => inner.glob(pattern, dir),
		exists: (path: string) => inner.exists(path),
		realpath: sharedRealpath(inner, reals),
	};
}

// SPEC §4.4.2: the core pack is always loaded; language packs join from
// config.packs order. A config that names core does not load it twice.
// Every pack resolves against the root-confined ports with one shared read
// cache, so scope files read repo-relatively (§4.1.1) exactly once per run.
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
		if (id === "core" || !isBuiltinPackId(id)) {
			continue;
		}
		const loaded = await loadBuiltinPack(id);
		if (!loaded.ok) {
			return err(loaded.error);
		}
		manifests.push(loaded.value.manifest);
	}
	const cached: CommandPorts = { ...ports, fs: sharedReads(ports.fs) };
	const enforcers: Array<Enforcer> = [];
	for (const manifest of manifests) {
		const resolved = resolveManifestEnforcers(manifest, cached);
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
