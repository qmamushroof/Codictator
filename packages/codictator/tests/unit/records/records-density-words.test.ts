// SPEC §4.9.2 core/doc-density: a code span counts as one word.
import { strict as assert } from "node:assert";
import test from "node:test";
import { checkDocDensity } from "../../../src/features/records/docs.ts";

function filler(count: number): string {
	return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

test("[§4.9.2] doc density counts a code span as one word", () => {
	// Use(1) + span(1) + now(1) + 37 fillers = 40 words: at the limit, silent.
	const atLimit = {
		path: "docs/TEST/00-AT-LIMIT.md",
		text: `Use \`a b c\` now ${filler(37)}.`,
	};
	assert.deepEqual(checkDocDensity([atLimit]), []);
	// One more filler = 41 words: the sentence flags.
	const over = {
		path: "docs/TEST/00-OVER.md",
		text: `Use \`a b c\` now ${filler(38)}.`,
	};
	const findings = checkDocDensity([over]);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/doc-density");
});
