// SPEC §4.16.3: template path builds the rule directly, offline, then
// validates, materialises deterministically, and self-tests. The pattern is
// an escaped literal of the sample prefix, or the explicit template
// parameter when the caller drafts a regex on purpose.
import {
	checkPattern,
	err,
	makeError,
	ok,
	type PackManifest,
	type PackRule,
	type Result,
} from "../../kernel/index.ts";
import { isBuiltinPackId } from "../packs/index.ts";
import type { DraftOptions, GeneratorInput } from "./index.ts";
import { draftViaLlm } from "./llm-draft.ts";
import { type RuleSpec, selfTestSpecs } from "./self-test.ts";
import { lookupTemplate } from "./templates.ts";

// The drafted literal pattern stays well under the §9.2 1,000-character
// budget so every offline draft passes the safety check by construction.
const MAX_LITERAL_PATTERN_CHARS = 200;
const DEFAULT_TEMPLATE = "forbid-pattern";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// SPEC §4.16 EC-9: a custom id must not impersonate a built-in pack. The
// head segment (before - or /) is checked so core-override cannot borrow the
// core namespace while unrelated ids stay valid.
function impersonatesBuiltin(id: string): boolean {
	const head = id.split("/")[0]?.split("-")[0] ?? id;
	return head !== id && isBuiltinPackId(head);
}

export function checkPackId(
	id: string,
	existing: ReadonlyArray<string>,
): Result<void> {
	if (id.length === 0) {
		return err(
			makeError(
				"CDX-E101",
				"pack draft needs a non-empty pack id",
				"Give the pack a lowercase id, then retry the draft.",
			),
		);
	}
	if (isBuiltinPackId(id) || impersonatesBuiltin(id) || existing.includes(id)) {
		return err(
			makeError(
				"CDX-E204",
				`custom pack id "${id}" collides with an existing pack id`,
				"Rename the pack id so it is unique and not a built-in id, then retry the draft.",
			),
		);
	}
	return ok(undefined);
}

// SPEC §4.16 EC-5 + §9.2: a short sample that is itself a catastrophic
// pattern is rejected before drafting. The generator cannot tell pasted
// regex text from fixture text, so it fails closed. Longer samples are
// fixture text only: the drafted pattern is an escaped literal.
function checkRawSample(sample: string): Result<void> {
	if (sample.length === 0 || sample.length > 1000) {
		return ok(undefined);
	}
	const checked = checkPattern(sample);
	if (checked.ok) {
		return ok(undefined);
	}
	const message = checked.error.message;
	if (
		message.includes("quantified group") ||
		message.includes("backreference")
	) {
		return err(checked.error);
	}
	return ok(undefined);
}

function ruleIdFor(packId: string): string {
	return `${packId}/rule-1`;
}

function draftTemplateSpec(
	input: GeneratorInput,
	options: DraftOptions,
): Result<RuleSpec> {
	const templateId = options.template ?? DEFAULT_TEMPLATE;
	const template = lookupTemplate(templateId);
	if (template === undefined) {
		return err(
			makeError(
				"CDX-E205",
				`draft references unknown template "${templateId}"`,
				"Use a template id from the §4.16.2 catalogue, then retry the draft.",
			),
		);
	}
	if (template.kind !== "pattern-forbid") {
		return err(
			makeError(
				"CDX-E205",
				`template "${templateId}" needs the loader-backed path`,
				"Draft a forbid-pattern template offline, or run the pack self-test after materialising.",
			),
		);
	}
	if (input.sampleBefore.length === 0) {
		return err(
			makeError(
				"CDX-E101",
				"pack draft needs a non-empty before sample",
				"Provide a violating example, then retry the draft.",
			),
		);
	}
	const raw = checkRawSample(input.sampleBefore);
	if (!raw.ok) {
		return err(raw.error);
	}
	const literal = escapeRegExp(
		input.sampleBefore.slice(0, MAX_LITERAL_PATTERN_CHARS),
	);
	const pattern = options.pattern ?? literal;
	const safe = checkPattern(pattern);
	if (!safe.ok) {
		return err(safe.error);
	}
	const ruleId = ruleIdFor(input.id);
	return ok({
		id: ruleId,
		kind: template.kind,
		pattern,
		reason: input.description,
		remediation: `Remove the text matching ${ruleId}; the pack fixtures show the violating and passing cases.`,
		tier: options.floorRuleId === ruleId ? "floor" : "tunable",
		violatingFixture: input.sampleBefore,
		passingFixture: input.sampleAfter,
	});
}

export function materialiseManifest(
	packId: string,
	description: string,
	specs: ReadonlyArray<RuleSpec>,
): PackManifest {
	const ordered = [...specs].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	const rules: Array<PackRule> = ordered.map((spec, index) => ({
		id: spec.id,
		family: "custom",
		tier: spec.tier,
		statement: `Forbid ${description}`,
		reason: spec.reason,
		remediation: spec.remediation,
		enforcer: spec.id,
		triggers: ["pre-tool"],
		scope: ["**/*"],
		params: {},
		measureVersion: 1,
		fixtures: {
			violating: [`violating-${String(index + 1)}.txt`],
			passing: [`passing-${String(index + 1)}.txt`],
		},
	}));
	const enforcers: Array<unknown> = ordered.map((spec) => ({
		id: spec.id,
		kind: spec.kind,
		budgetMs: 1000,
		args:
			spec.pattern === undefined ? {} : { pattern: spec.pattern, paths: [] },
	}));
	return {
		id: packId,
		version: "0.1.0",
		description,
		rules,
		enforcers,
		drivers: [],
		extractors: [],
		measures: [],
		capabilities: [],
		assets: [],
		maxWaiverDays: 30,
	};
}

export function draftViaTemplate(
	input: GeneratorInput,
	options: DraftOptions,
): Result<PackManifest> {
	const spec = draftTemplateSpec(input, options);
	if (!spec.ok) {
		return err(spec.error);
	}
	const tested = selfTestSpecs([spec.value]);
	if (!tested.ok) {
		return err(tested.error);
	}
	return ok(materialiseManifest(input.id, input.description, [spec.value]));
}

export function draftWithOptions(
	input: GeneratorInput,
	options: DraftOptions,
): Promise<Result<PackManifest>> {
	const checked = checkPackId(input.id, options.existingPackIds ?? []);
	if (!checked.ok) {
		return Promise.resolve(err(checked.error));
	}
	if (options.useLlm === true) {
		return draftViaLlm(input, options);
	}
	return Promise.resolve(draftViaTemplate(input, options));
}
