// SPEC §4.2.2: section validators for workflow, architecture, tools, llm,
// packs and harnesses. Each throws the CdxError its SPEC row owns.

import {
	e101Invalid,
	fail,
	field,
	isRecord,
	KNOWN_HARNESSES,
	KNOWN_PROFILES,
	MANDATORY_PHASES,
} from "./validate-shared.ts";

// SPEC §4.17: llm keys holding secrets, and the env-var suffix that marks a
// reference instead of a literal value. Local: only validateLlm uses them.
const SECRET_KEY_PATTERN = /(key|token|secret)/i;
const ENV_REF_SUFFIX = /env$/i;

export function validateWorkflowPhases(raw: unknown): void {
	if (!Array.isArray(raw)) {
		e101Invalid("#/workflow/phases", "an array of phases");
	}
	const names: Array<string> = [];
	for (const entry of raw) {
		const name = isRecord(entry) ? field(entry, "name") : undefined;
		if (typeof name !== "string") {
			e101Invalid("#/workflow/phases", "phases with string names");
		}
		names.push(name);
	}
	const mentioned = names.filter((name) => MANDATORY_PHASES.includes(name));
	if (mentioned.length === 0) {
		return;
	}
	let previous = -1;
	for (const name of mentioned) {
		const at = MANDATORY_PHASES.indexOf(name);
		if (at <= previous) {
			fail(
				"CDX-E105",
				`workflow reorders mandatory phase "${name}"`,
				"Keep the seven mandatory phases in their SPEC §4.12.2 order; insert custom phases around them.",
			);
		}
		previous = at;
	}
	if (mentioned.length !== MANDATORY_PHASES.length) {
		const missing = MANDATORY_PHASES.filter(
			(name) => !mentioned.includes(name),
		);
		fail(
			"CDX-E105",
			`workflow removes mandatory phase "${missing.join(", ")}"`,
			"Restore every mandatory phase of SPEC §4.12.2; custom phases are additions only.",
		);
	}
}

function moduleDeps(raw: unknown): ReadonlyArray<string> | undefined {
	if (!isRecord(raw) || !Array.isArray(field(raw, "dependsOn"))) {
		return undefined;
	}
	const found = field(raw, "dependsOn");
	if (!Array.isArray(found)) {
		return undefined;
	}
	const deps: Array<string> = [];
	for (const entry of found) {
		if (typeof entry !== "string") {
			return undefined;
		}
		deps.push(entry);
	}
	return deps;
}

function findCycle(
	modules: ReadonlyMap<string, ReadonlyArray<string>>,
): Array<string> | undefined {
	const visiting = new Set<string>();
	const done = new Set<string>();
	const walk = (
		name: string,
		trail: ReadonlyArray<string>,
	): Array<string> | undefined => {
		if (done.has(name)) {
			return undefined;
		}
		if (visiting.has(name)) {
			return [...trail, name];
		}
		visiting.add(name);
		const deps = modules.get(name) ?? [];
		for (const dep of deps) {
			const found = walk(dep, [...trail, name]);
			if (found !== undefined) {
				return found;
			}
		}
		visiting.delete(name);
		done.add(name);
		return undefined;
	};
	for (const name of modules.keys()) {
		const found = walk(name, []);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function checkArchitectureProfile(raw: Record<string, unknown>): void {
	const profile = field(raw, "profile");
	if (profile === undefined) {
		return;
	}
	if (typeof profile !== "string" || !KNOWN_PROFILES.has(profile)) {
		fail(
			"CDX-E101",
			`unknown architecture profile "${String(profile)}"`,
			"Use one of app, library, cli or service (SPEC §4.11.1).",
		);
	}
}

function collectModuleDeps(
	modules: ReadonlyArray<unknown>,
): Map<string, ReadonlyArray<string>> {
	const deps = new Map<string, ReadonlyArray<string>>();
	for (const entry of modules) {
		const name = isRecord(entry) ? field(entry, "name") : undefined;
		if (typeof name !== "string") {
			e101Invalid("#/architecture/modules", "modules with string names");
		}
		deps.set(name, moduleDeps(entry) ?? []);
	}
	return deps;
}

export function validateArchitecture(raw: unknown): void {
	if (!isRecord(raw)) {
		e101Invalid("#/architecture", "an object");
	}
	checkArchitectureProfile(raw);
	const modules = field(raw, "modules");
	if (modules === undefined) {
		return;
	}
	if (!Array.isArray(modules)) {
		e101Invalid("#/architecture/modules", "an array of modules");
	}
	const cycle = findCycle(collectModuleDeps(modules));
	if (cycle !== undefined) {
		fail(
			"CDX-E105",
			`architecture change closes a cycle: ${cycle.join(" -> ")}`,
			"Remove a dependsOn edge so the module graph stays acyclic (SPEC §4.11.2).",
		);
	}
}

export function validateTools(raw: unknown): void {
	if (!Array.isArray(raw)) {
		e101Invalid("#/tools", "an array of tools");
	}
	for (const entry of raw) {
		if (!isRecord(entry)) {
			e101Invalid("#/tools", "an array of tool objects");
		}
		const version = field(entry, "version");
		if (
			!isRecord(version) ||
			typeof field(version, "pin") !== "string" ||
			field(version, "pin") === ""
		) {
			fail(
				"CDX-E206",
				"tool without an exact version pin",
				"Give every config.tools entry an exact version.pin, then retry.",
			);
		}
	}
}

export function validateLlm(raw: unknown): void {
	if (!isRecord(raw)) {
		e101Invalid("#/llm", "an object");
	}
	for (const key of Object.keys(raw)) {
		if (!SECRET_KEY_PATTERN.test(key) || ENV_REF_SUFFIX.test(key)) {
			continue;
		}
		const value = field(raw, key);
		if (typeof value === "string" && value !== "") {
			fail(
				"CDX-E106",
				`literal secret in config.llm.${key}`,
				"Reference secrets by env-var name (for example llm.apiKeyEnv), never by literal value (§4.17).",
			);
		}
	}
}

function packEntryId(entry: unknown): string {
	const id = isRecord(entry) ? field(entry, "id") : undefined;
	if (typeof id !== "string" || id === "") {
		e101Invalid("#/packs", "packs with non-empty string ids");
	}
	return id;
}

function checkPackKeys(entry: unknown, id: string): void {
	if (!isRecord(entry)) {
		return;
	}
	for (const key of Object.keys(entry)) {
		if (key !== "id" && key !== "version" && key !== "path") {
			e101Invalid(`#/packs/${id}/${key}`, "id, version or path");
		}
	}
}

function checkDuplicatePackId(ids: ReadonlySet<string>, id: string): void {
	if (ids.has(id)) {
		fail(
			"CDX-E101",
			`duplicate pack id "${id}"`,
			"List each pack once, at one pinned version.",
		);
	}
}

export function validatePacks(raw: unknown): Set<string> {
	if (!Array.isArray(raw)) {
		e101Invalid("#/packs", "an array of packs");
	}
	const ids = new Set<string>();
	for (const entry of raw) {
		const id = packEntryId(entry);
		checkPackKeys(entry, id);
		checkDuplicatePackId(ids, id);
		ids.add(id);
	}
	return ids;
}

export function validateHarnesses(raw: unknown): void {
	if (!Array.isArray(raw) || raw.length === 0) {
		e101Invalid("#/harnesses", "a non-empty array of harness ids");
	}
	for (const entry of raw) {
		if (typeof entry !== "string" || entry === "") {
			e101Invalid("#/harnesses", "a non-empty array of harness ids");
		}
		if (!KNOWN_HARNESSES.has(entry) && !entry.startsWith("custom:")) {
			fail(
				"CDX-E301",
				`unknown harness id "${entry}"`,
				"Use an installed adapter id (§7.2) or a custom: id with an adapter in .codictator/adapters/.",
			);
		}
	}
}
