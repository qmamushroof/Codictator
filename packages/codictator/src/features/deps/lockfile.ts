// SPEC §6.1: package-lock.json (v3); pnpm/yarn frozen-lockfile commands run
// through the external contract in a later phase.
import {
	err,
	makeError,
	ok,
	parseJson,
	type Result,
} from "../../kernel/index.ts";
import { field, isJsonRecord, recordField, stringField } from "./fields.ts";
import type { NpmDependency } from "./npm.ts";
import { isExactNpmPin, isUnversionedNpmSource } from "./npm.ts";

export interface NpmLockfile {
	readonly lockfileVersion: number;
	readonly pinned: Readonly<Record<string, string>>;
}

function stringTable(value: unknown): Record<string, string> {
	if (!isJsonRecord(value)) {
		return {};
	}
	const table: Record<string, string> = {};
	for (const key of Object.keys(value).sort()) {
		const entry = value[key];
		if (typeof entry === "string") {
			table[key] = entry;
		}
	}
	return table;
}

function collectRootPins(
	packages: Record<string, unknown>,
	pinned: Record<string, string>,
): void {
	const rootEntry = recordField(packages, "");
	if (rootEntry === undefined) {
		return;
	}
	for (const key of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		for (const [name, range] of Object.entries(
			stringTable(field(rootEntry, key)),
		)) {
			pinned[name] = range;
		}
	}
}

function collectNestedPins(
	packages: Record<string, unknown>,
	pinned: Record<string, string>,
): void {
	for (const [path, entry] of Object.entries(packages)) {
		if (!path.startsWith("node_modules/") || !isJsonRecord(entry)) {
			continue;
		}
		const name = path.slice("node_modules/".length);
		const entryVersion = stringField(entry, "version");
		if (entryVersion !== undefined && pinned[name] === undefined) {
			pinned[name] = entryVersion;
		}
	}
}

export function parsePackageLock(text: string): Result<NpmLockfile> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	if (!isJsonRecord(parsed.value)) {
		return err(
			makeError(
				"CDX-E101",
				"package-lock.json must hold a JSON object at its root",
				"Regenerate the lockfile with the ecosystem tool.",
			),
		);
	}
	const root = parsed.value;
	const packages = recordField(root, "packages");
	if (packages === undefined) {
		return err(
			makeError(
				"CDX-E101",
				"package-lock.json has no packages table",
				"Regenerate the lockfile with the ecosystem tool.",
			),
		);
	}
	const pinned: Record<string, string> = {};
	collectRootPins(packages, pinned);
	collectNestedPins(packages, pinned);
	const version = field(root, "lockfileVersion");
	return ok({
		lockfileVersion: typeof version === "number" ? version : 0,
		pinned,
	});
}

// SPEC §4.8.5 core/dep-lockfile: every manifest pin resolves to the same
// version in the lockfile; ranges can never be in sync.
export function lockfileMismatches(
	dependencies: ReadonlyArray<NpmDependency>,
	lock: NpmLockfile,
): ReadonlyArray<string> {
	const mismatched: Array<string> = [];
	for (const dep of dependencies) {
		if (dep.kind === "peer" || isUnversionedNpmSource(dep.range)) {
			continue;
		}
		if (!isExactNpmPin(dep.range)) {
			mismatched.push(dep.name);
			continue;
		}
		const locked = lock.pinned[dep.name];
		const wanted = dep.range.replace(/^v/, "");
		if (locked === undefined || locked.replace(/^v/, "") !== wanted) {
			mismatched.push(dep.name);
		}
	}
	return mismatched.sort();
}
