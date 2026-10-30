// SPEC §4.16.3, LLM path: prompt, complete, validate with one repair round,
// materialise and self-test. The client port comes from options.llm (12.1
// owns the client); this module only consumes it, never implements it.
import {
	err,
	makeError,
	ok,
	type PackManifest,
	parseJson,
	type Result,
} from "../../kernel/index.ts";
import type { CompletionRequest, LlmClient } from "../llm/index.ts";
import { materialiseManifest } from "./draft.ts";
import type { DraftOptions, GeneratorInput } from "./index.ts";
import { buildPrompt, DEFAULT_MODEL, selectPromptParts } from "./prompt.ts";
import { type RuleSpec, selfTestSpecs } from "./self-test.ts";
import {
	lookupTemplate,
	narrowPackDraft,
	type PackDraft,
} from "./templates.ts";

const MAX_OUTPUT_TOKENS = 1024;

function narrowText(
	text: string,
	packId: string,
	floorRuleId: string | undefined,
): Result<PackDraft> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return err(
			makeError(
				"CDX-E853",
				"LLM draft is not valid JSON",
				"Draft offline with --template, or fix the generator prompt, then retry.",
			),
		);
	}
	return narrowPackDraft(parsed.value, packId, floorRuleId);
}

function draftToSpecs(draft: PackDraft): Array<RuleSpec> {
	return draft.rules.map((rule) => {
		const base = {
			id: rule.id,
			kind: lookupTemplate(rule.template)?.kind ?? rule.template,
			reason: rule.reason,
			remediation: rule.remediation,
			tier: rule.tier,
			violatingFixture: rule.violatingFixture,
			passingFixture: rule.passingFixture,
		};
		// Bracket access through a variable keeps
		// noPropertyAccessFromIndexSignature satisfied without tripping
		// useLiteralKeys (kernel narrows the same way).
		const patternKey = "pattern";
		const raw = rule.params[patternKey];
		if (typeof raw === "string") {
			return { ...base, pattern: raw };
		}
		return base;
	});
}

// One repair round sends the validation errors back; a still invalid draft
// fails CDX-E853. Pattern-safety (CDX-E902) fails closed without a repair
// round.
async function narrowWithRepair(
	client: LlmClient,
	request: CompletionRequest,
	text: string,
	input: GeneratorInput,
	floorRuleId: string | undefined,
): Promise<Result<PackDraft>> {
	const first = narrowText(text, input.id, floorRuleId);
	if (first.ok) {
		return first;
	}
	if (first.error.code === "CDX-E902") {
		return first;
	}
	const retry = await client.complete({
		model: request.model,
		prompt: `${request.prompt}\n\nThe previous draft was invalid: ${first.error.message} Return only corrected JSON.`,
		maxOutputTokens: request.maxOutputTokens,
	});
	if (!retry.ok) {
		return err(retry.error);
	}
	const second = narrowText(retry.value.text, input.id, floorRuleId);
	if (second.ok) {
		return second;
	}
	if (second.error.code === "CDX-E902") {
		return second;
	}
	return err(
		makeError(
			"CDX-E853",
			"LLM draft is still invalid after one repair round",
			"Draft offline with --template, or fix the generator prompt, then retry.",
		),
	);
}

export async function draftViaLlm(
	input: GeneratorInput,
	options: DraftOptions,
): Promise<Result<PackManifest>> {
	const client = options.llm;
	if (client === undefined) {
		return err(
			makeError(
				"CDX-E851",
				"no LLM configured for --llm",
				"Set config.llm (the meta preset suggests model muse-spark-1.3 with apiKeyEnv MODEL_API_KEY) or draft offline with --template.",
			),
		);
	}
	const selected = selectPromptParts(input, options);
	const prompt = buildPrompt(input, selected);
	const request: CompletionRequest = {
		model: DEFAULT_MODEL,
		prompt,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
	};
	const responded = await client.complete(request);
	if (!responded.ok) {
		return err(responded.error);
	}
	const draft = await narrowWithRepair(
		client,
		request,
		responded.value.text,
		input,
		options.floorRuleId,
	);
	if (!draft.ok) {
		return err(draft.error);
	}
	const specs = draftToSpecs(draft.value);
	const tested = selfTestSpecs(specs);
	if (!tested.ok) {
		return err(tested.error);
	}
	return ok(materialiseManifest(input.id, draft.value.description, specs));
}
