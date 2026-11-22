// SPEC §4.9.2 + §4.14.1 (BUG-0117): a file the guardrail manifest lists is
// generated and owned by its template, so core/doc-single-owner neither
// judges it nor counts it as a duplicate source. Hand-written docs are still
// judged against each other; a missing or tampered manifest exempts nothing.
import { strict as assert } from "node:assert";
import test from "node:test";
import { buildManifest } from "../../../src/features/integrity/index.ts";
import { resolveDocSingleOwner } from "../../../src/features/packs/enforcers/docs-guards.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { runLive } from "../../support/l3-live-scenario.ts";

const SHARED =
	"The generated skill sentence carries more than twelve words so the owner check sees it twice.";
const SKILL_A = ".agents/skills/codictator-bug-record/SKILL.md";
const SKILL_B = ".agents/skills/codictator-review/SKILL.md";
const MEMORY = ".agents/memory/codictator.md";

const MANIFEST = stableStringify(
	buildManifest(
		"1.0.0",
		[SKILL_A, SKILL_B, MEMORY].map((path) => ({
			path,
			owner: "core",
			mode: "file" as const,
			hash: "a",
		})),
	),
);

const doc = (text: string): string => `# Doc\n\n${text}\n`;

test("[§4.9.2] doc-single-owner ignores two manifest-listed files sharing a sentence (BUG-0117)", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			".codictator/manifest.json": MANIFEST,
			[SKILL_A]: doc(SHARED),
			[SKILL_B]: doc(SHARED),
		},
		staged: [SKILL_A, SKILL_B],
	});
	assert.deepEqual(found, []);
});

test("[§4.9.2] doc-single-owner ignores a manifest-listed file repeating a hand-written doc (BUG-0117)", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			".codictator/manifest.json": MANIFEST,
			[MEMORY]: doc(SHARED),
			"docs/guide.md": doc(SHARED),
		},
		staged: [MEMORY, "docs/guide.md"],
	});
	assert.deepEqual(found, []);
});

test("[§4.9.2] doc-single-owner still flags two hand-written docs beside a manifest (BUG-0117)", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			".codictator/manifest.json": MANIFEST,
			"docs/guide.md": doc(SHARED),
			"docs/other.md": doc(SHARED),
		},
		staged: ["docs/guide.md", "docs/other.md"],
	});
	assert.equal(found.length, 1);
});

test("[§4.9.2] doc-single-owner exempts nothing when the manifest is missing or tampered (BUG-0117)", async () => {
	const tampered = stableStringify({
		...JSON.parse(MANIFEST),
		hash: "0".repeat(64),
	});
	for (const manifest of [undefined, tampered]) {
		const found = await runLive(
			resolveDocSingleOwner,
			"core/doc-single-owner",
			{
				worktree: {
					...(manifest === undefined
						? {}
						: { ".codictator/manifest.json": manifest }),
					[SKILL_A]: doc(SHARED),
					[SKILL_B]: doc(SHARED),
				},
				staged: [SKILL_A, SKILL_B],
			},
		);
		assert.equal(found.length, 1);
	}
});
