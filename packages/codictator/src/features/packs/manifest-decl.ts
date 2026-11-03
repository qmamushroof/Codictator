// SPEC §4.4.3 step 4: enforcer declaration narrowing. Split from
// manifest.ts by responsibility: this file owns the declaration shape (id,
// kind, options and the external binding); manifest.ts owns the manifest
// shape and the pack-level checks. manifest.ts re-exports this surface so
// rule authors keep a single import.
import { err, makeError, ok, type Result } from "../../kernel/index.ts";

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

function narrowDeclIdentity(
	entry: Record<string, unknown>,
): Result<{ id: string; kind: string }> {
	const id = field(entry, "id");
	if (typeof id !== "string" || id.length === 0) {
		return declError(
			"unknown",
			"needs a non-empty string id",
			"Give the enforcer an id matching the rule that names it, then reload.",
		);
	}
	const kind = field(entry, "kind");
	if (typeof kind !== "string" || !KNOWN_ENFORCER_KINDS.includes(kind)) {
		return declError(
			id,
			"names an unknown kind",
			"Use a §4.4.6 kind or code, then reload the pack.",
		);
	}
	return ok({ id, kind });
}

function declArgs(entry: Record<string, unknown>): { args?: unknown } {
	if (!("args" in entry)) {
		return {};
	}
	return { args: field(entry, "args") };
}

// SPEC §4.4.3 step 4: the optional declaration fields. A missing module
// leaves resolution to the owning kind; a missing budget takes the default.
function narrowDeclOptions(
	entry: Record<string, unknown>,
	id: string,
): Result<{ module?: string; budgetMs: number; args?: unknown }> {
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
	return ok({
		...(typeof moduleValue === "string" ? { module: moduleValue } : {}),
		budgetMs: typeof budgetValue === "number" ? budgetValue : DEFAULT_BUDGET_MS,
		...declArgs(entry),
	});
}

function narrowExternalBinding(
	entry: Record<string, unknown>,
	id: string,
): Result<{ tool: string; ruleMap: Readonly<Record<string, string>> }> {
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
	return ok({ tool, ruleMap: mapped });
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
	const identity = narrowDeclIdentity(entry);
	if (!identity.ok) {
		return identity;
	}
	const options = narrowDeclOptions(entry, identity.value.id);
	if (!options.ok) {
		return options;
	}
	if (identity.value.kind !== "external") {
		return ok({
			id: identity.value.id,
			kind: identity.value.kind,
			...options.value,
		});
	}
	const binding = narrowExternalBinding(entry, identity.value.id);
	if (!binding.ok) {
		return binding;
	}
	return ok({
		id: identity.value.id,
		kind: identity.value.kind,
		...options.value,
		tool: binding.value.tool,
		ruleMap: binding.value.ruleMap,
	});
}
