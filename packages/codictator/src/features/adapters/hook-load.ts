// SPEC §4.19.3 steps 2-3: hook root resolution and effective-config load.
// Split from runtime.ts; the repo root comes from the payload cwd (or the
// process cwd) via git, and the effective config resolves against the
// root-confined Fs, with the keyed cache short-circuiting repeat runs.
import type { Env } from "../../kernel/index.ts";
import {
	NodeFs,
	NodeGit,
	parseJson,
	stableStringify,
} from "../../kernel/index.ts";
import type { EffectiveConfig } from "../config/index.ts";
import { HOOK_MARKER, loadConfig } from "../config/index.ts";
import type { Adapter, HookReply } from "./contract.ts";
import { cacheKeyFor, readCacheFile, storeBytes } from "./effective-cache.ts";
import { allowReply, blockReply } from "./hook-dispatch.ts";
import type { HookBasePorts } from "./runtime.ts";

// SPEC §4.2.3 with §4.19.3: CODICTATOR_HOOK=1 is the launcher's own mark
// on the hook process, authorizing evaluation; the §4.2.3 refusal targets
// agent markers on human-only commands, not the hook reading config to
// evaluate. The runtime loads config with every marker intact except the
// launcher's own, so a foreign agent marker in the hook environment still
// refuses CDX-E107 through loadConfig.
export function hookEnv(env: Env): Env {
	return {
		get: (name: string): string | undefined =>
			name === HOOK_MARKER ? undefined : env.get(name),
	};
}

// SPEC §4.19.3 step 2: the repo root from the payload cwd, else the process
// cwd, via git rev-parse. A cwd git cannot resolve is outside any Codictator
// repo, so the hook allows silently and the git-hook/CI backstops keep
// enforcing (§4.2 EC-2). The resolved root is canonicalized once via the
// kernel Fs port before config load and engine confinement: confinePath
// realpaths files before comparing against the root, so the root side must
// be canonical too — on macOS $TMPDIR lives under /var, which is a symlink
// to /private/var, and an unresolved root fails every confined access
// closed with CDX-E701. Only the kernel touches node:fs (§10.3 item 3), so
// this goes through NodeFs (whose explicit-root create already resolves via
// realpath) and reads the canonical root back with realpath(".").
// realpath is idempotent when no symlinks are present, so this is a no-op
// on Windows/Linux; a root NodeFs cannot resolve keeps the git answer, so
// unreadable roots still fail closed with CDX-E801 downstream instead of
// here.
async function canonicalRoot(root: string): Promise<string> {
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return root;
	}
	const real = await made.value.realpath(".");
	if (!real.ok) {
		return root;
	}
	return real.value;
}

export async function resolveRoot(
	ports: HookBasePorts,
	startDir: string,
): Promise<string | undefined> {
	const git = new NodeGit(ports.proc, startDir);
	const root = await git.root();
	if (!root.ok) {
		return undefined;
	}
	return canonicalRoot(root.value);
}

// SPEC §4.19.3 step 3: the effective-config cache file. The keyed cache
// read lives in effective-cache.ts; the repo-relative rel paths stay here
// with the loader that reads them (§4.1.1).
const CACHE_REL = ".codictator/cache/effective.json";
const CONFIG_REL = ".codictator/config.json";
const WAIVERS_REL = ".codictator/waivers.json";
const BASELINE_REL = ".codictator/baseline.json";

export async function loadEffective(
	ports: HookBasePorts,
	root: string,
	adapter: Adapter,
): Promise<
	| { readonly ok: true; value: EffectiveConfig }
	| { readonly ok: false; reply: HookReply }
> {
	const fsMade = await NodeFs.create({ root });
	if (!fsMade.ok) {
		return {
			ok: false,
			reply: blockReply(adapter, "CDX-E801", fsMade.error.message),
		};
	}
	// SPEC §4.1.1: Fs paths are repo-relative, so every call below is
	// relative (CONFIG_REL, CACHE_REL). loadConfig takes the same logical
	// root for the same reason; the Fs is already confined to root.
	const fs = fsMade.value;
	const seen = await fs.exists(CONFIG_REL);
	if (!seen.ok) {
		return {
			ok: false,
			reply: blockReply(adapter, "CDX-E801", seen.error.message),
		};
	}
	if (!seen.value) {
		return { ok: false, reply: allowReply(adapter, "no-config") };
	}
	const bytes = await fs.read(CONFIG_REL);
	if (!bytes.ok) {
		return {
			ok: false,
			reply: blockReply(adapter, "CDX-E801", bytes.error.message),
		};
	}
	const key = cacheKeyFor([
		bytes.value,
		await storeBytes(fs, WAIVERS_REL),
		await storeBytes(fs, BASELINE_REL),
	]);
	const cached = await fs.readText(CACHE_REL);
	if (cached.ok) {
		const parsed = parseJson(cached.value);
		if (parsed.ok) {
			const hit = readCacheFile(parsed.value, key);
			if (hit !== undefined) {
				return {
					ok: true,
					value: { config: hit, configHash: key },
				};
			}
		}
	}
	let effective: EffectiveConfig;
	try {
		// The Fs is already confined to root, so the logical root is "."
		// and config resolution reads repo-relative paths (§4.1.1).
		effective = await loadConfig(".", {
			fs,
			proc: ports.proc,
			net: ports.net,
			clock: ports.clock,
			git: new NodeGit(ports.proc, root),
			env: hookEnv(ports.env),
		});
	} catch (error) {
		return {
			ok: false,
			reply: blockReply(
				adapter,
				errorCodeOf(error, "CDX-E101"),
				errorMessageOf(error),
			),
		};
	}
	// Best effort: a cache write failure never blocks the hook; the
	// resolved config is authoritative and the next run re-resolves.
	const line = new TextEncoder().encode(
		stableStringify({ v: 1, key, config: effective.config }),
	);
	const written = await fs.write(CACHE_REL, line);
	if (!written.ok) {
		return { ok: true, value: effective };
	}
	return { ok: true, value: effective };
}

export function errorCodeOf(error: unknown, fallback: string): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code !== ""
	) {
		return error.code;
	}
	return fallback;
}

// SPEC §9.2 with CONVENTIONS: error text never carries payload content,
// so pre-engine blocks use static strings only.
export function errorMessageOf(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return "the hook runtime failed before evaluation";
}
