// SPEC §4.4.3 steps 2–4: manifest checks with the codes §8 owns. Reads the
// fields the checks need; the kernel schema check owns the full format.
import { err, makeError, ok, type Result } from "../../kernel/index.ts";
import type { PackManifest } from "./index.ts";

export interface EnforcerDecl {
	readonly id: string;
	readonly kind: string;
	readonly module?: string;
	readonly budgetMs: number;
	readonly tool?: string;
	readonly ruleMap?: Readonly<Record<string, string>>;
	// SPEC §7.3: the pack-author binding for the kind (§4.4.6 args, §4.4.5
	// external input/output). Narrowed by the owning enforcer module, never
	// here, so new kinds need no loader change.
	readonly args?: unknown;
}

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

// SPEC §4.4.6 plus code: every kind accepted in an enforcer declaration.
// Parametric kinds resolve deferred until step 5.4 wires them.
const KNOWN_ENFORCER_KINDS: ReadonlyArray<string> = [
	"code",
	"pattern-forbid",
	"pattern-require",
	"path-placement",
	"file-size",
	"file-required",
	"import-forbid",
	"command-forbid",
	"json-key",
	"external",
];

// SPEC §4.4.6: the budget a declaration carries when it names none. The
// self-test runs every fixture inside twice this budget (CDX-E215).
const DEFAULT_BUDGET_MS = 1000;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (kernel narrows the same way).
export function field(
	record: Readonly<Record<string, unknown>>,
	name: string,
): unknown {
	return record[name];
}

function declError(id: string, detail: string, fix: string): Result<never> {
	return err(
		makeError("CDX-E205", `pack enforcer "${id}" ${detail}`, `${fix}`),
	);
}

// SPEC §4.4.3 step 4: the declaration must name a known kind and carry a
// usable id; anything else is unresolvable (CDX-E205). External bindings
// are shape-checked here, fully interpreted by step 5.5.
export function narrowEnforcerDecl(entry: unknown): Result<EnforcerDecl> {
	if (!isRecord(entry)) {
		return declError(
			"unknown",
			"must be a JSON object",
			"Give the enforcer an id and a §4.4.6 kind, then reload the pack.",
		);
	}
	const id = field(entry, "id");
	const kind = field(entry, "kind");
	if (typeof id !== "string" || id.length === 0) {
		return declError(
			"unknown",
			"needs a non-empty string id",
			"Give the enforcer an id matching the rule that names it, then reload.",
		);
	}
	if (typeof kind !== "string" || !KNOWN_ENFORCER_KINDS.includes(kind)) {
		return declError(
			id,
			"names an unknown kind",
			"Use a §4.4.6 kind or code, then reload the pack.",
		);
	}
	const moduleValue = field(entry, "module");
	if (moduleValue !== undefined && typeof moduleValue !== "string") {
		return declError(
			id,
			"carries a non-string module",
			"Name the owning module as a string, then reload the pack.",
		);
	}
	const budgetValue = field(entry, "budgetMs");
	if (
		budgetValue !== undefined &&
		(typeof budgetValue !== "number" ||
			!Number.isInteger(budgetValue) ||
			budgetValue <= 0)
	) {
		return declError(
			id,
			"carries a budgetMs that is not a positive integer",
			"Give the enforcer a positive integer budgetMs, then reload the pack.",
		);
	}
	const moduleDecl =
		typeof moduleValue === "string" ? { module: moduleValue } : {};
	// SPEC §7.3: args ride along opaquely; the owning enforcer module
	// narrows them (parametric kinds in step 5.4, external in step 5.5).
	const argsDecl = "args" in entry ? { args: field(entry, "args") } : {};
	if (kind !== "external") {
		return ok({
			id,
			kind,
			...moduleDecl,
			...argsDecl,
			budgetMs:
				typeof budgetValue === "number" ? budgetValue : DEFAULT_BUDGET_MS,
		});
	}
	const tool = field(entry, "tool");
	const ruleMap = field(entry, "ruleMap");
	if (typeof tool !== "string" || tool.length === 0 || !isRecord(ruleMap)) {
		return declError(
			id,
			"needs a tool id and a ruleMap object",
			"Bind the enforcer to a config.tools id with a ruleMap, then reload.",
		);
	}
	const mapped: Record<string, string> = {};
	for (const key of Object.keys(ruleMap)) {
		const target = ruleMap[key];
		if (typeof target !== "string" || target.length === 0) {
			return declError(
				id,
				"carries a ruleMap value that is not a rule id",
				"Map every tool rule id to a rule id of the same pack, then reload.",
			);
		}
		mapped[key] = target;
	}
	return ok({
		id,
		kind,
		...moduleDecl,
		...argsDecl,
		budgetMs: typeof budgetValue === "number" ? budgetValue : DEFAULT_BUDGET_MS,
		tool,
		ruleMap: mapped,
	});
}

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
