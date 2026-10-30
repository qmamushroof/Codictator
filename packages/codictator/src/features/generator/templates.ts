// SPEC §4.16.2: the template catalogue and the pack-draft shape (§4.16.3).
// Validation here mirrors schema/pack-draft.schema.json so the LLM draft,
// the prompt and the offline checks agree on one definition.
import {
	checkPattern,
	err,
	makeError,
	ok,
	type Result,
} from "../../kernel/index.ts";

export interface TemplateDecl {
	readonly id: string;
	readonly kind: string;
	readonly description: string;
}

// SPEC §4.16.2: every template id the generator accepts, with the enforcer
// kind it materialises into. Only parametric data is ever produced (§11 S23:
// an LLM never authors executable enforcement code).
const TEMPLATE_CATALOGUE: ReadonlyArray<TemplateDecl> = [
	{
		id: "forbid-pattern",
		kind: "pattern-forbid",
		description: "forbid text matching a regex",
	},
	{
		id: "require-pattern",
		kind: "pattern-require",
		description: "require text matching a regex",
	},
	{
		id: "forbid-import",
		kind: "import-forbid",
		description: "forbid imports matching a module glob",
	},
	{
		id: "placement",
		kind: "path-placement",
		description: "confine files to allowed directories",
	},
	{
		id: "max-size",
		kind: "file-size",
		description: "cap file lines or bytes",
	},
	{
		id: "forbid-command",
		kind: "command-forbid",
		description: "forbid shell commands matching a pattern",
	},
	{
		id: "require-file",
		kind: "file-required",
		description: "require a file with matching content",
	},
	{
		id: "config-key",
		kind: "json-key",
		description: "require a config key and value",
	},
	{
		id: "external",
		kind: "external",
		description: "delegate to a configured external tool",
	},
];

export function lookupTemplate(id: string): TemplateDecl | undefined {
	return TEMPLATE_CATALOGUE.find((entry) => entry.id === id);
}

// SPEC §4.16.3: the catalogue line the LLM prompt carries.
export function catalogueSummary(): string {
	return TEMPLATE_CATALOGUE.map((entry) => `${entry.id} -> ${entry.kind}`).join(
		", ",
	);
}

export type DraftTier = "floor" | "tunable";

export interface DraftRule {
	readonly id: string;
	readonly template: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly statement: string;
	readonly reason: string;
	readonly remediation: string;
	readonly tier: DraftTier;
	readonly violatingFixture: string;
	readonly passingFixture: string;
}

export interface PackDraft {
	readonly packId: string;
	readonly description: string;
	readonly rules: ReadonlyArray<DraftRule>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied (kernel narrows the same way).
function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function draftError(detail: string): Result<never> {
	return err(
		makeError(
			"CDX-E853",
			`LLM draft is invalid: ${detail}`,
			"Draft offline with --template, or fix the generator prompt, then retry.",
		),
	);
}

function templateError(template: string): Result<never> {
	return err(
		makeError(
			"CDX-E205",
			`draft references unknown template "${template}"`,
			"Use a template id from the §4.16.2 catalogue, then retry the draft.",
		),
	);
}

function ownerError(ruleId: string, packId: string): Result<never> {
	return err(
		makeError(
			"CDX-E204",
			`draft rule "${ruleId}" is outside pack "${packId}"`,
			"Generated packs own only their own rule ids; rename the rule under the pack id, then retry.",
		),
	);
}

function nonEmptyText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function narrowRule(
	value: unknown,
	packId: string,
	floorRuleId: string | undefined,
): Result<DraftRule> {
	if (!isRecord(value)) {
		return draftError("every rule must be a JSON object");
	}
	const id = field(value, "id");
	const template = field(value, "template");
	const params = field(value, "params");
	const statement = field(value, "statement");
	const reason = field(value, "reason");
	const remediation = field(value, "remediation");
	const tier = field(value, "tier");
	const violatingFixture = field(value, "violatingFixture");
	const passingFixture = field(value, "passingFixture");
	if (!nonEmptyText(id)) {
		return draftError("every rule needs a non-empty string id");
	}
	if (!id.startsWith(`${packId}/`)) {
		return ownerError(id, packId);
	}
	if (typeof template !== "string" || lookupTemplate(template) === undefined) {
		return templateError(typeof template === "string" ? template : "unknown");
	}
	if (!isRecord(params)) {
		return draftError(`rule "${id}" needs a params object`);
	}
	if (!nonEmptyText(statement)) {
		return draftError(`rule "${id}" needs a non-empty statement`);
	}
	if (!nonEmptyText(reason)) {
		return draftError(`rule "${id}" needs a non-empty reason`);
	}
	if (!nonEmptyText(remediation) || remediation === reason) {
		return draftError(
			`rule "${id}" needs remediation distinct from its reason`,
		);
	}
	if (tier !== "floor" && tier !== "tunable") {
		return draftError(`rule "${id}" tier must be floor or tunable`);
	}
	if (tier === "floor" && id !== floorRuleId) {
		return draftError(
			`rule "${id}" is floor without --floor; strictness is a human choice`,
		);
	}
	if (!nonEmptyText(violatingFixture)) {
		return draftError(`rule "${id}" needs a violating fixture`);
	}
	if (!nonEmptyText(passingFixture)) {
		return draftError(`rule "${id}" needs a passing fixture`);
	}
	// SPEC §4.16 EC-5 + §9.2: every drafted regex passes the kernel safety
	// check before use; a catastrophic pattern fails the draft here.
	const rawPattern = field(params, "pattern");
	if (typeof rawPattern === "string") {
		const safe = checkPattern(rawPattern);
		if (!safe.ok) {
			return err(safe.error);
		}
	}
	return ok({
		id,
		template,
		params,
		statement,
		reason,
		remediation,
		tier,
		violatingFixture,
		passingFixture,
	});
}

// SPEC §4.16.3: schema-check the draft. Pattern-safety failures keep their
// CDX-E902 so the caller can fail closed without a repair round; every other
// failure is repairable and returns CDX-E205, CDX-E204 or CDX-E853.
export function narrowPackDraft(
	value: unknown,
	expectedPackId: string,
	floorRuleId?: string,
): Result<PackDraft> {
	if (!isRecord(value)) {
		return draftError("the draft must be a JSON object");
	}
	const packId = field(value, "packId");
	const description = field(value, "description");
	const rules = field(value, "rules");
	if (packId !== expectedPackId) {
		return draftError("the draft packId must equal the requested pack id");
	}
	if (!nonEmptyText(description)) {
		return draftError("the draft needs a non-empty description");
	}
	if (!Array.isArray(rules) || rules.length === 0) {
		return draftError("the draft needs at least one rule");
	}
	const narrowed: Array<DraftRule> = [];
	for (const entry of rules) {
		const rule = narrowRule(entry, expectedPackId, floorRuleId);
		if (!rule.ok) {
			return err(rule.error);
		}
		narrowed.push(rule.value);
	}
	return ok({ packId: expectedPackId, description, rules: narrowed });
}
