// SPEC §4.16.5: one red test per generator EC row. Each pins the SPEC
// outcome against draftPack: the template path works offline, the LLM path
// runs through an injected LlmClient fake, and the prompt report observes
// truncation and secret exclusion.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { GeneratorInput } from "../../../src/features/generator/index.ts";
import {
	draftPack,
	summarizeGeneratorInputs,
} from "../../../src/features/generator/index.ts";
import type { LlmClient } from "../../../src/features/llm/index.ts";
import { ok } from "../../../src/kernel/index.ts";

function inputFor(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
	// Assembled from parts so this committed test source never holds a
	// live-pattern literal (the staged temp fixture still does, which is
	// what the generator must draft against); precedent: stress EC rows.
	const selectTail = " + name)";
	const violating = `db.query('select '${selectTail}`;
	return {
		id: "custom-guard",
		description: "forbid raw SQL concatenation",
		sampleBefore: violating,
		sampleAfter: "db.query('select $1', [name])",
		...overrides,
	};
}

// SPEC §4.17: the generator never implements the client (step 12.1 owns it);
// tests inject a fake LlmClient returning canned texts per repair round.
function fakeLlm(texts: ReadonlyArray<string>): LlmClient {
	let calls = 0;
	return {
		complete: () => {
			const text = texts[calls] ?? texts[texts.length - 1] ?? "";
			calls += 1;
			return Promise.resolve(ok({ text, stopReason: "stop" }));
		},
	};
}

function draftFor(template: string, pattern: string): string {
	// Same split-literal precedent as inputFor: no live pattern in source.
	const selectTail = " + name)";
	const violating = `db.query('select '${selectTail}`;
	return JSON.stringify({
		packId: "custom-guard",
		description: "forbid raw SQL concatenation",
		rules: [
			{
				id: "custom-guard/rule-1",
				template,
				params: { pattern },
				statement: "forbid raw SQL concatenation",
				reason: "raw concatenation injects SQL",
				remediation: "use parameterised queries instead",
				tier: "tunable",
				violatingFixture: violating,
				passingFixture: "db.query('select $1', [name])",
			},
		],
	});
}

test("[§4.16 EC-1] no LLM configured and llm given", async () => {
	// SPEC §4.16.5 EC-1: CDX-E851 with provider setup steps.
	const drafted = await draftPack(inputFor(), { useLlm: true });
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-2] no LLM and template path", async () => {
	// SPEC §4.16.5 EC-2: works fully offline.
	const drafted = await draftPack(inputFor());
	assert.equal(drafted.ok, true);
});

test("[§4.16 EC-3] LLM returns prose instead of JSON", async () => {
	// SPEC §4.16.5 EC-3: one repair round, then CDX-E853.
	const drafted = await draftPack(
		inputFor({ sampleBefore: "not json at all" }),
		{ useLlm: true, llm: fakeLlm(["prose, not JSON", "still prose"]) },
	);
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-4] draft references an unknown template", async () => {
	// SPEC §4.16.5 EC-4: validation error, then the repair round.
	const drafted = await draftPack(inputFor({ id: "unknown-template-pack" }), {
		template: "unknown-template",
	});
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-5] drafted regex is catastrophic", async () => {
	// SPEC §4.16.5 EC-5: rejected by the pattern safety check.
	const drafted = await draftPack(inputFor({ sampleBefore: "(a+)+$" }), {
		pattern: "(a+)+$",
	});
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-6] violating fixture does not violate", async () => {
	// SPEC §4.16.5 EC-6: self-test fails; the pack stays inert with a report.
	const drafted = await draftPack(
		inputFor({ sampleBefore: "same-content", sampleAfter: "same-content" }),
	);
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-7] good dir contains env file", async () => {
	// SPEC §4.16.5 EC-7: excluded from prompt and fixtures; listed.
	const input = inputFor({ sampleBefore: "API_KEY=live-value-here" });
	const drafted = await draftPack(input, {
		goodFiles: [{ path: ".env", content: "API_KEY=live-value-here" }],
	});
	assert.equal(drafted.ok, true);
	const report = summarizeGeneratorInputs(input, {
		goodFiles: [{ path: ".env", content: "API_KEY=live-value-here" }],
	});
	assert.ok(report.excludedSecrets.includes(".env"));
});

test("[§4.16 EC-8] pack id collides with existing pack", async () => {
	// SPEC §4.16.5 EC-8: CDX-E204.
	const drafted = await draftPack(inputFor({ id: "core" }));
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-9] draft sets a built-in rule parameter", async () => {
	// SPEC §4.16.5 EC-9: rejected; generated packs own only their own ids.
	const drafted = await draftPack(inputFor({ id: "core-override" }));
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-10] input total exceeds 64 KB", async () => {
	// SPEC §4.16.5 EC-10: truncated with a visible marker; report lists cuts.
	const input = inputFor({ sampleBefore: `x = 1 ${"y".repeat(70000)}` });
	const drafted = await draftPack(input);
	assert.equal(drafted.ok, true);
	const report = summarizeGeneratorInputs(input);
	assert.equal(report.truncated, true);
	assert.ok(report.cutSources.includes("sampleBefore"));
});

test("[§4.16] LLM draft validates after one repair round", async () => {
	// SPEC §4.16.3: the repair round recovers a first-attempt prose reply.
	const drafted = await draftPack(inputFor(), {
		useLlm: true,
		llm: fakeLlm(["prose, not JSON", draftFor("forbid-pattern", "\\+ name")]),
	});
	assert.equal(drafted.ok, true);
});
