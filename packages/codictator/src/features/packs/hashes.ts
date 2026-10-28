// SPEC §7.4 and §4.4.7: the hashes covering a custom pack. packHash covers
// every file in the pack except accepted.json itself, sorted by path, as
// the canonical hash of { path, sha256 } entries; selfTestHash covers the
// manifest rules the self-test ran on. Both use kernel canonical JSON and
// raw bytes, so CRLF and reordering cannot fake agreement (§4.1.2).
import type { Fs, Result } from "../../kernel/index.ts";
import {
	err,
	makeError,
	ok,
	parseJson,
	sha256Hex,
	sha256Text,
	stableStringify,
	validateSchema,
} from "../../kernel/index.ts";
import type { PackManifest } from "./index.ts";
import { field, isRecord } from "./manifest.ts";
export const ACCEPTED_NAME = "accepted.json";

interface HashedFile {
	readonly path: string;
	readonly hash: string;
}

// SPEC §7.4: packHash covers every file in the pack except this one, sorted
// by path. Directories are skipped by stat; a stat or read failure fails
// closed instead of silently dropping the file.
export async function packHashFor(
	fs: Fs,
	dir: string,
): Promise<Result<string>> {
	const listed = await fs.glob("**", dir);
	if (!listed.ok) {
		return err(listed.error);
	}
	const base = dir === "" ? "" : `${dir}/`;
	const rels: Array<string> = [];
	for (const full of listed.value) {
		if (!full.startsWith(base)) {
			continue;
		}
		const rel = full.slice(base.length);
		if (rel === ACCEPTED_NAME) {
			continue;
		}
		const st = await fs.stat(full);
		if (!st.ok) {
			return err(st.error);
		}
		if (st.value.isFile) {
			rels.push(rel);
		}
	}
	rels.sort();
	const entries: Array<HashedFile> = [];
	for (const rel of rels) {
		const content = await fs.read(`${base}${rel}`);
		if (!content.ok) {
			return err(content.error);
		}
		entries.push({ path: rel, hash: sha256Hex(content.value) });
	}
	return ok(sha256Text(stableStringify(entries)));
}

// The self-test record: the pack identity plus the sorted rules the
// self-test ran, so any rule, fixture or param change invalidates it.
export function selfTestHashFor(manifest: PackManifest): string {
	const rules = [...manifest.rules].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	return sha256Text(
		stableStringify({ pack: manifest.id, rules, version: manifest.version }),
	);
}

// SPEC §4.4.4 and §4.4.7: a pack carrying accepted.json loads only while
// its content hash still matches. A pack never accepted loads without a
// gate; acceptance happens after `pack test` through acceptPack.
export async function verifyAcceptance(
	fs: Fs,
	dir: string,
	manifest: PackManifest,
	acceptedSchemaText: string,
): Promise<Result<void>> {
	const acceptedPath = dir === "" ? ACCEPTED_NAME : `${dir}/${ACCEPTED_NAME}`;
	const seen = await fs.exists(acceptedPath);
	if (!seen.ok) {
		return err(seen.error);
	}
	if (!seen.value) {
		return ok(undefined);
	}
	const text = await fs.readText(acceptedPath);
	if (!text.ok) {
		return err(text.error);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	const checked = validateSchema(acceptedSchemaText, parsed.value);
	if (!checked.ok) {
		return err(checked.error);
	}
	const record = parsed.value;
	const packHash = isRecord(record) ? field(record, "packHash") : undefined;
	if (typeof packHash !== "string") {
		return err(
			makeError(
				"CDX-E203",
				`pack "${manifest.id}" accepted.json carries no packHash string`,
				"Re-run codictator pack test, then codictator pack accept, to rewrite accepted.json.",
			),
		);
	}
	const hashed = await packHashFor(fs, dir);
	if (!hashed.ok) {
		return err(hashed.error);
	}
	if (hashed.value !== packHash) {
		return err(
			makeError(
				"CDX-E203",
				`pack "${manifest.id}" changed after acceptance and is inert until re-accepted`,
				"Run codictator pack test, then codictator pack accept, to re-accept the pack.",
			),
		);
	}
	return ok(undefined);
}
