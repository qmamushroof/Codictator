// SPEC §4.2.2: validation rules for config.json. Every check throws the
// CdxError its SPEC row owns; the CLI maps codes to exit codes.

import type { Config } from "./index.ts";
import {
	validateArchitecture,
	validateHarnesses,
	validateLlm,
	validatePacks,
	validateTools,
	validateWorkflowPhases,
} from "./validate-sections.ts";
import {
	e101Invalid,
	fail,
	field,
	isRecord,
	KNOWN_TOP_KEYS,
} from "./validate-shared.ts";
import { validateTunables } from "./validate-tunables.ts";

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
