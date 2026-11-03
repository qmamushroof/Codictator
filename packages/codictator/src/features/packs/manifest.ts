// SPEC §4.4.3 steps 2–4: manifest checks with the codes §8 owns. Reads the
// fields the checks need; the kernel schema check owns the full format.
// Declaration narrowing lives in manifest-decl.ts, re-exported here so rule
// authors keep a single import.
import { err, makeError, ok, type Result } from "../../kernel/index.ts";
import type { PackManifest } from "./index.ts";
import {
	type EnforcerDecl,
	field,
	isRecord,
	narrowEnforcerDecl,
} from "./manifest-decl.ts";

export { type EnforcerDecl, field, isRecord, narrowEnforcerDecl };

// SPEC §4.4.2: built-in pack ids; a custom pack must not equal one (§4.4.3).
const BUILTIN_IDS: ReadonlyArray<string> = [
	"core",
	"typescript",
	"dotnet",
	"python",
];

export function isBuiltinPackId(id: string): boolean {
	return BUILTIN_IDS.includes(id);
}

// SPEC §4.4.3 step 4: declaration narrowing lives in manifest-decl.ts.
function manifestError(detail: string): Result<never> {
	return err(
		makeError(
			"CDX-E203",
			`pack manifest is invalid: ${detail}`,
			"Fix the pack.json so it matches schema/pack.schema.json, then reload the pack.",
		),
	);
}

// The kernel schema check owns the format; this narrows unknown to the
// manifest shape the checks below read (config narrows the same way).
export function narrowManifest(value: unknown): Result<PackManifest> {
	if (!isRecord(value)) {
		return manifestError("the manifest must be a JSON object");
	}
	const id = field(value, "id");
	if (typeof id !== "string" || id.length === 0) {
		return manifestError('the manifest needs a non-empty string "id"');
	}
	const rules = field(value, "rules");
	if (!Array.isArray(rules)) {
		return manifestError('the manifest needs a "rules" array');
	}
	for (const rule of rules) {
		if (!isRecord(rule)) {
			return manifestError("every rule must be a JSON object");
		}
		if (
			typeof field(rule, "id") !== "string" ||
			typeof field(rule, "enforcer") !== "string"
		) {
			return manifestError('every rule needs string "id" and "enforcer"');
		}
	}
	const enforcers = field(value, "enforcers");
	if (!Array.isArray(enforcers)) {
		return manifestError('the manifest needs an "enforcers" array');
	}
	// Every field above is verified, and the kernel schema check verified
	// the rest, so the unknown-to-manifest narrowing is exact.
	return ok(value as unknown as PackManifest);
}

// SPEC §4.4.3 steps 2–4 plus the §4.4.5 ruleMap boundary (CDX-E210).
export function checkPack(
	manifest: PackManifest,
	builtin: boolean,
): Result<void> {
	const seen = new Set<string>();
	for (const rule of manifest.rules) {
		if (seen.has(rule.id)) {
			return err(
				makeError(
					"CDX-E202",
					`duplicate rule id "${rule.id}" in pack "${manifest.id}"`,
					"Give every rule a globally unique id, then reload the pack.",
				),
			);
		}
		seen.add(rule.id);
	}
	if (!builtin) {
		if (BUILTIN_IDS.includes(manifest.id)) {
			return err(
				makeError(
					"CDX-E204",
					`custom pack id "${manifest.id}" collides with a built-in pack id`,
					"Rename the pack id so it is not core, typescript, dotnet or python, then reload.",
				),
			);
		}
		for (const rule of manifest.rules) {
			if (!rule.id.startsWith(`${manifest.id}/`)) {
				return err(
					makeError(
						"CDX-E204",
						`custom pack "${manifest.id}" rule id "${rule.id}" must start with "${manifest.id}/"`,
						"Rename the rule id under the pack namespace, then reload.",
					),
				);
			}
		}
	}
	const declared = new Map<string, EnforcerDecl>();
	for (const entry of manifest.enforcers) {
		const narrowed = narrowEnforcerDecl(entry);
		if (!narrowed.ok) {
			return err(narrowed.error);
		}
		declared.set(narrowed.value.id, narrowed.value);
	}
	for (const rule of manifest.rules) {
		if (!declared.has(rule.enforcer)) {
			return err(
				makeError(
					"CDX-E205",
					`rule "${rule.id}" names unknown enforcer "${rule.enforcer}"`,
					"Declare the enforcer in the pack or use a built-in parametric enforcer (§4.4.6), then reload.",
				),
			);
		}
	}
	for (const decl of declared.values()) {
		if (decl.kind === "external" && decl.ruleMap !== undefined) {
			for (const target of Object.values(decl.ruleMap)) {
				if (!seen.has(target)) {
					return err(
						makeError(
							"CDX-E210",
							`external enforcer "${decl.id}" maps to "${target}" outside pack "${manifest.id}"`,
							"Map the tool rule to a rule id of the same pack, then reload.",
						),
					);
				}
			}
		}
	}
	return ok(undefined);
}
