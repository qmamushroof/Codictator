// SPEC §4.2.2: validation rules for config.json. Every check throws the
// CdxError its SPEC row owns; the CLI maps codes to exit codes.

import type { CdxError } from "../../kernel/index.ts";
import { makeError } from "../../kernel/index.ts";
import type { Config } from "./index.ts";
import type { ParamSpec } from "./pack-data.ts";
import { FLOOR_RULES, TUNABLE_PARAMS } from "./pack-data.ts";

// SPEC §7.2 and schema/config.schema.json: the only accepted top-level keys.
const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set([
	"version",
	"codictator",
	"packs",
	"harnesses",
	"tunables",
	"architecture",
	"workflow",
	"spec",
	"testing",
	"commands",
	"steering",
	"tools",
	"security",
	"deps",
	"network",
	"integrity",
	"ci",
	"llm",
]);

// SPEC §7.2: adapter ids, plus custom: names.
const KNOWN_HARNESSES: ReadonlySet<string> = new Set([
	"muse-code",
	"universal",
	"claude-code",
	"copilot",
	"codex-cli",
	"cursor",
	"gemini-cli",
	"opencode",
]);

// SPEC §4.11.1: the architecture profiles.
const KNOWN_PROFILES: ReadonlySet<string> = new Set([
	"app",
	"library",
	"cli",
	"service",
]);

// SPEC §4.12.2: the seven mandatory phases in order.
const MANDATORY_PHASES: ReadonlyArray<string> = [
	"discovery",
	"planning",
	"implementation",
	"validation",
	"review",
	"record",
	"integrate",
];

const SECRET_KEY_PATTERN = /(key|token|secret)/i;
const ENV_REF_SUFFIX = /env$/i;

function fail(
	code: string,
	message: string,
	remediation: string,
	detail?: string,
): never {
	const error: CdxError =
		detail === undefined
			? makeError(code, message, remediation)
			: makeError(code, message, remediation, detail);
	throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (kernel schema.ts pattern).
function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function e101Invalid(path: string, expected: string): never {
	fail(
		"CDX-E101",
		`value at ${path} is invalid: expected ${expected}`,
		"Fix the value so it matches schema/config.schema.json, then retry.",
	);
}

function checkTunablesShape(
	ruleId: string,
	raw: unknown,
): Record<string, unknown> {
	if (!isRecord(raw)) {
		e101Invalid(`#/tunables/${ruleId}`, "an object of parameters");
	}
	// The red suite pins { params: { ... } }; SPEC §7.2 shows the params
	// inline. Both normalize to the parameter map before per-param checks.
	const params = field(raw, "params");
	if (params !== undefined) {
		if (!isRecord(params)) {
			e101Invalid(`#/tunables/${ruleId}/params`, "an object of parameters");
		}
		return params;
	}
	return raw;
}

function checkNumericParam(
	ruleId: string,
	name: string,
	spec: {
		readonly default: number;
		readonly bound: number;
		readonly stricter: "lower" | "higher";
	},
	value: unknown,
): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		e101Invalid(
			`#/tunables/${ruleId}/${name}`,
			"a finite number at or above zero",
		);
	}
	const looser =
		spec.stricter === "lower" ? value > spec.default : value < spec.default;
	if (looser) {
		fail(
			"CDX-E104",
			`tunable ${ruleId} ${name}=${value} is looser than the pack default ${spec.default}`,
			`Move the loosening into .codictator/waivers.json (bound ${spec.bound}), or tighten ${name} to ${spec.default} or stricter.`,
		);
	}
}

function checkSetParam(
	ruleId: string,
	name: string,
	spec: {
		readonly default: ReadonlyArray<string>;
		readonly stricter: "subset" | "superset";
	},
	value: unknown,
): void {
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		e101Invalid(`#/tunables/${ruleId}/${name}`, "an array of strings");
	}
	const values: ReadonlyArray<string> = value;
	const looser =
		spec.stricter === "subset"
			? values.some((entry) => !spec.default.includes(entry))
			: spec.default.some((entry) => !values.includes(entry));
	if (looser) {
		fail(
			"CDX-E104",
			`tunable ${ruleId} ${name} is looser than the pack default`,
			"Move the loosening into .codictator/waivers.json, or tighten the list back toward the default.",
		);
	}
}

function checkParamValue(
	ruleId: string,
	name: string,
	spec: ParamSpec,
	value: unknown,
): void {
	if (spec.kind === "policy") {
		return;
	}
	if (spec.kind === "set") {
		checkSetParam(ruleId, name, spec, value);
		return;
	}
	checkNumericParam(ruleId, name, spec, value);
}

function rulePackId(ruleId: string): string {
	const slash = ruleId.indexOf("/");
	return slash < 0 ? ruleId : ruleId.slice(0, slash);
}

function validateTunables(raw: unknown, packIds: ReadonlySet<string>): void {
	if (!isRecord(raw)) {
		e101Invalid("#/tunables", "an object keyed by rule id");
	}
	for (const ruleId of Object.keys(raw)) {
		const packId = rulePackId(ruleId);
		if (!packIds.has(packId)) {
			fail(
				"CDX-E101",
				`tunable rule "${ruleId}" needs pack "${packId}", which config.packs does not load`,
				`Add "${packId}" to config.packs or remove the tunable.`,
			);
		}
		if (FLOOR_RULES.has(ruleId)) {
			fail(
				"CDX-E103",
				`floor rule ${ruleId} has no override`,
				"Remove it from tunables; floor rules cannot be loosened or waived.",
			);
		}
		const spec = TUNABLE_PARAMS[ruleId];
		if (spec === undefined) {
			fail(
				"CDX-E101",
				`unknown tunable rule "${ruleId}"`,
				"Use a rule id from a loaded pack, then retry.",
			);
		}
		const params = checkTunablesShape(ruleId, field(raw, ruleId));
		for (const name of Object.keys(params)) {
			const param = field(spec, name);
			if (!isParamSpec(param)) {
				e101Invalid(
					`#/tunables/${ruleId}/${name}`,
					"a parameter the rule declares",
				);
			}
			checkParamValue(ruleId, name, param, field(params, name));
		}
	}
}

function isParamSpec(value: unknown): value is ParamSpec {
	if (!isRecord(value) || typeof field(value, "kind") !== "string") {
		return false;
	}
	return (
		field(value, "kind") === "number" ||
		field(value, "kind") === "set" ||
		field(value, "kind") === "policy"
	);
}

function validateWorkflowPhases(raw: unknown): void {
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

function validateArchitecture(raw: unknown): void {
	if (!isRecord(raw)) {
		e101Invalid("#/architecture", "an object");
	}
	const profile = field(raw, "profile");
	if (
		profile !== undefined &&
		(typeof profile !== "string" || !KNOWN_PROFILES.has(profile))
	) {
		fail(
			"CDX-E101",
			`unknown architecture profile "${String(profile)}"`,
			"Use one of app, library, cli or service (SPEC §4.11.1).",
		);
	}
	const modules = field(raw, "modules");
	if (modules === undefined) {
		return;
	}
	if (!Array.isArray(modules)) {
		e101Invalid("#/architecture/modules", "an array of modules");
	}
	const deps = new Map<string, ReadonlyArray<string>>();
	for (const entry of modules) {
		const name = isRecord(entry) ? field(entry, "name") : undefined;
		if (typeof name !== "string") {
			e101Invalid("#/architecture/modules", "modules with string names");
		}
		deps.set(name, moduleDeps(entry) ?? []);
	}
	const cycle = findCycle(deps);
	if (cycle !== undefined) {
		fail(
			"CDX-E105",
			`architecture change closes a cycle: ${cycle.join(" -> ")}`,
			"Remove a dependsOn edge so the module graph stays acyclic (SPEC §4.11.2).",
		);
	}
}

function validateTools(raw: unknown): void {
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

function validateLlm(raw: unknown): void {
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

function validatePacks(raw: unknown): Set<string> {
	if (!Array.isArray(raw)) {
		e101Invalid("#/packs", "an array of packs");
	}
	const ids = new Set<string>();
	for (const entry of raw) {
		const id = isRecord(entry) ? field(entry, "id") : undefined;
		if (typeof id !== "string" || id === "") {
			e101Invalid("#/packs", "packs with non-empty string ids");
		}
		for (const key of Object.keys(entry)) {
			if (key !== "id" && key !== "version" && key !== "path") {
				e101Invalid(`#/packs/${id}/${key}`, "id, version or path");
			}
		}
		if (ids.has(id)) {
			fail(
				"CDX-E101",
				`duplicate pack id "${id}"`,
				"List each pack once, at one pinned version.",
			);
		}
		ids.add(id);
	}
	return ids;
}

function validateHarnesses(raw: unknown): void {
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

// SPEC §4.2.2: every validation rule. Throws the CdxError its row owns and
// returns the narrowed Config on success.
export function validateConfigValue(
	value: unknown,
	engineVersion: string,
): Config {
	if (!isRecord(value)) {
		e101Invalid("#", "a config object");
	}
	for (const key of Object.keys(value)) {
		if (!KNOWN_TOP_KEYS.has(key)) {
			fail(
				"CDX-E101",
				`unknown top-level key "${key}"`,
				"Remove the key or move it under the section schema/config.schema.json defines.",
			);
		}
	}
	if (field(value, "version") !== 1) {
		e101Invalid("#/version", "the const 1");
	}
	const codictator = field(value, "codictator");
	if (typeof codictator !== "string" || codictator === "") {
		e101Invalid("#/codictator", "the installed engine version");
	}
	if (codictator !== engineVersion) {
		fail(
			"CDX-E102",
			`config.codictator "${codictator}" does not match the installed engine "${engineVersion}"`,
			`Set "codictator" to "${engineVersion}" in .codictator/config.json.`,
		);
	}
	const packIds = validatePacks(field(value, "packs"));
	validateHarnesses(field(value, "harnesses"));
	const tunables = field(value, "tunables");
	if (tunables !== undefined) {
		validateTunables(tunables, packIds);
	}
	const workflow = field(value, "workflow");
	if (workflow !== undefined) {
		if (!isRecord(workflow)) {
			e101Invalid("#/workflow", "an object");
		}
		if (field(workflow, "phases") !== undefined) {
			validateWorkflowPhases(field(workflow, "phases"));
		}
	}
	const architecture = field(value, "architecture");
	if (architecture !== undefined) {
		validateArchitecture(architecture);
	}
	const tools = field(value, "tools");
	if (tools !== undefined) {
		validateTools(tools);
	}
	const llm = field(value, "llm");
	if (llm !== undefined) {
		validateLlm(llm);
	}
	// Every field above is verified, so the unknown-to-Config narrowing is
	// exact: the intermediate unknown keeps the cast from widening.
	return value as unknown as Config;
}
