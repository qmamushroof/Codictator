// SPEC §4.9.2 core/doc-density: a sentence never ends inside a code span,
// and masked/original indices stay aligned, so spans survive slicing.
import { strict as assert } from "node:assert";
import test from "node:test";
import { splitSentences } from "../../../src/features/records/docs.ts";

test("[§4.9.2] doc sentences never split inside a code span", () => {
	const sentences = splitSentences(
		"See `code.with.dots.inside` for detail. Next sentence here.",
	);
	assert.deepEqual(sentences, [
		"See `code.with.dots.inside` for detail.",
		"Next sentence here.",
	]);
});

test("[§4.9.2] doc sentences keep a long span from swallowing the tail", () => {
	const paragraph = `Call \`this.is.a.very.long.code.span.that.keeps.going\` now. Short tail.`;
	const sentences = splitSentences(paragraph);
	assert.equal(sentences.length, 2);
	assert.ok(sentences[0]?.endsWith("now."));
	assert.equal(sentences[1], "Short tail.");
	assert.ok(
		(sentences[0]?.length ?? 0) < paragraph.length - "Short tail.".length,
	);
});
