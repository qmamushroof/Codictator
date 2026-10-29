// SPEC §4.19.3 step 3: the effective-config cache key and read. The key
// hashes the config, waivers and baseline file bytes (pack versions ride
// in config.codictator, §4.4.2); a missing store hashes as absent, so
// creating one mismatches a key cached without it. The Fs port carries no
// mtime, so the key is a content hash rather than a timestamp. A corrupt
// cache re-resolves instead of blocking: the cache is an optimization,
// never authority.
import type { Fs } from "../../kernel/index.ts";
import { sha256Hex } from "../../kernel/index.ts";
import type { Config } from "../config/index.ts";
import { validateConfig } from "../config/index.ts";

// A missing store hashes as these absent bytes, never as empty input, so
// an empty file and a missing file key differently.
const ABSENT_BYTES = new TextEncoder().encode("absent");

export async function storeBytes(fs: Fs, rel: string): Promise<Uint8Array> {
	const seen = await fs.exists(rel);
	if (!seen.ok || !seen.value) {
		return ABSENT_BYTES;
	}
	const read = await fs.read(rel);
	return read.ok ? read.value : ABSENT_BYTES;
}

export function cacheKeyFor(parts: ReadonlyArray<Uint8Array>): string {
	let total = 0;
	for (const part of parts) {
		total += part.length + 1;
	}
	const joined = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		joined.set(part, at);
		at += part.length;
		joined[at] = 0;
		at += 1;
	}
	return sha256Hex(joined);
}

export function readCacheFile(raw: unknown, key: string): Config | undefined {
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}
	if (!("v" in raw) || !("key" in raw) || !("config" in raw)) {
		return undefined;
	}
	if (raw.v !== 1 || raw.key !== key) {
		return undefined;
	}
	try {
		return validateConfig(raw.config).config;
	} catch {
		return undefined;
	}
}
