// SPEC §7.5: the waivers file on disk, split from waivers.ts by
// responsibility (CONVENTIONS size). Missing or unreadable reads as no
// waivers; malformed entries are inert (never suppress), while the loud
// core/waivers-valid rule reports the file problem at L3/L4.
import type { Fs } from "../../kernel/index.ts";
import { parseJson } from "../../kernel/index.ts";
import type { Waiver } from "./waivers.ts";

// SPEC §7.5: the waivers file on disk, relative to the repo root.
const WAIVERS_REL = ".codictator/waivers.json";

interface WaiverEntryShape {
	readonly id: unknown;
	readonly rule: unknown;
	readonly params: unknown;
	readonly paths: unknown;
	readonly reason: unknown;
	readonly created: unknown;
	readonly expires: unknown;
	readonly createdBy: unknown;
	readonly renews: unknown;
}

function isRecordLike(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}

function hasScalarFields(entry: WaiverEntryShape): boolean {
	return (
		typeof entry.id === "string" &&
		typeof entry.rule === "string" &&
		typeof entry.reason === "string" &&
		typeof entry.created === "string" &&
		typeof entry.expires === "string" &&
		typeof entry.createdBy === "string"
	);
}

function hasParamsField(entry: WaiverEntryShape): boolean {
	return (
		typeof entry.params === "object" &&
		entry.params !== null &&
		!Array.isArray(entry.params)
	);
}

function hasPathsField(entry: WaiverEntryShape): boolean {
	if (entry.paths === undefined) {
		return true;
	}
	return (
		Array.isArray(entry.paths) &&
		entry.paths.every((path) => typeof path === "string")
	);
}

function hasRenewsField(entry: WaiverEntryShape): boolean {
	return entry.renews === undefined || typeof entry.renews === "string";
}

// SPEC §7.5: a waiver entry counts only when every field has its shape;
// an invalid entry is inert, so an invalid waiver never suppresses (fail
// closed, PRD §12 #12). One named helper per field group keeps the entry
// gate under core/complexity (SPEC §5.6).
function isWaiverEntry(value: unknown): value is Waiver {
	if (!isRecordLike(value)) {
		return false;
	}
	const entry = value as WaiverEntryShape;
	return (
		hasScalarFields(entry) &&
		hasParamsField(entry) &&
		hasPathsField(entry) &&
		hasRenewsField(entry)
	);
}

// SPEC §4.2.1 step 3: the waiver entries the evaluation loads. Tier and
// bound checks stay with the consumers (params overlay, matchWaivers) and
// the waivers-valid rule; this read only shapes the entries.
export async function readWaiverFile(fs: Fs): Promise<Array<Waiver>> {
	const seen = await fs.exists(WAIVERS_REL);
	if (!seen.ok || !seen.value) {
		return [];
	}
	const text = await fs.readText(WAIVERS_REL);
	if (!text.ok) {
		return [];
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return [];
	}
	const value = parsed.value as { waivers?: unknown } | Array<unknown>;
	const list = Array.isArray(value) ? value : value.waivers;
	if (!Array.isArray(list)) {
		return [];
	}
	return list.filter(isWaiverEntry);
}
