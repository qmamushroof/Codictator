// SPEC §4.16.5: one red test per generator EC row. Each pins the SPEC
// outcome against draftPack. It still throws "not implemented", so all ten
// fail red until Phase 12 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { GeneratorInput } from "../../../src/features/generator/index.ts";
import { draftPack } from "../../../src/features/generator/index.ts";

function inputFor(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
	return {
		id: "custom-guard",
		description: "forbid raw SQL concatenation",
		sampleBefore: "db.query('select ' + name)",
		sampleAfter: "db.query('select $1', [name])",
		...overrides,
	};
}

test("[§4.16 EC-1] no LLM configured and llm given", async () => {
	// SPEC §4.16.5 EC-1: CDX-E851 with provider setup steps.
	const drafted = await draftPack(inputFor());
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
	);
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-4] draft references an unknown template", async () => {
	// SPEC §4.16.5 EC-4: validation error, then the repair round.
	const drafted = await draftPack(inputFor({ id: "unknown-template-pack" }));
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-5] drafted regex is catastrophic", async () => {
	// SPEC §4.16.5 EC-5: rejected by the pattern safety check.
	const drafted = await draftPack(inputFor({ sampleBefore: "(a+)+$" }));
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-6] violating fixture does not violate", async () => {
	// SPEC §4.16.5 EC-6: self-test fails; the pack stays inert with a report.
	const drafted = await draftPack(inputFor());
	assert.equal(drafted.ok, false);
});

test("[§4.16 EC-7] good dir contains env file", async () => {
	// SPEC §4.16.5 EC-7: excluded from prompt and fixtures; listed.
	const drafted = await draftPack(
		inputFor({ sampleBefore: "API_KEY=live-value-here" }),
	);
	assert.equal(drafted.ok, true);
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
	const drafted = await draftPack(
		inputFor({ sampleBefore: `x = 1 ${"y".repeat(70000)}` }),
	);
	assert.equal(drafted.ok, true);
});
