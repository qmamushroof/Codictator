// SPEC §4.9.2 (BUG-0107): the four doc rules the L3 stage probe silenced
// judge the staged real markdown, not only fixture marker reports. Links,
// inline changelogs, router shape and a sentence owned twice are decidable
// on the files themselves; record docs and fixtures stay out.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	resolveDocRouterLeaf,
	resolveDocSingleOwner,
} from "../../../src/features/packs/enforcers/docs-guards.ts";
import {
	resolveDocLinksValid,
	resolveDocNoInlineChangelog,
} from "../../../src/features/packs/enforcers/docs-guards-measures.ts";
import { runLive } from "../../support/l3-live-scenario.ts";

const SHARED =
	"The shared consumer sentence carries more than twelve words so the owner check sees it twice.";

test("[§4.9.2] L3 doc-links-valid flags a relative link whose target is missing", async () => {
	const found = await runLive(resolveDocLinksValid, "core/doc-links-valid", {
		worktree: { "docs/guide.md": "# Guide\n\nSee [gone](./gone.md).\n" },
		staged: ["docs/guide.md"],
	});
	assert.equal(found.length, 1);
	assert.equal(found[0]?.path, "docs/guide.md");
	assert.match(found[0]?.message ?? "", /link target missing/);
});

test("[§4.9.2] L3 doc-links-valid flags an anchor no heading slug matches and passes a good link", async () => {
	const found = await runLive(resolveDocLinksValid, "core/doc-links-valid", {
		worktree: {
			"docs/guide.md":
				"# Guide\n\n[ok](./other.md#real-part) and [bad](./other.md#nope)\n",
			"docs/other.md": "# Other\n\n## Real part\n",
		},
		staged: ["docs/guide.md"],
	});
	assert.equal(found.length, 1);
	assert.match(found[0]?.message ?? "", /link anchor missing: #nope/);
});

test("[§4.9.2] L3 doc-links-valid leaves a record doc and an external link alone", async () => {
	const found = await runLive(resolveDocLinksValid, "core/doc-links-valid", {
		worktree: {
			"docs/HISTORY/2026-11-08.md": "# History\n\n[x](./nowhere.md)\n",
			"docs/guide.md": "# Guide\n\n[web](https://example.com/a)\n",
		},
		staged: ["docs/HISTORY/2026-11-08.md", "docs/guide.md"],
	});
	assert.deepEqual(found, []);
});

test("[§4.9.2] L3 doc-no-inline-changelog flags a dated change line and a changelog heading", async () => {
	const found = await runLive(
		resolveDocNoInlineChangelog,
		"core/doc-no-inline-changelog",
		{
			worktree: {
				"docs/guide.md": "# Guide\n\nUpdated on 2026-01-01: added things.\n",
				"docs/other.md": "# Other\n\n## Changelog\n",
			},
			staged: ["docs/guide.md", "docs/other.md"],
		},
	);
	assert.deepEqual(found.map((f) => f.path).sort(), [
		"docs/guide.md",
		"docs/other.md",
	]);
});

test("[§4.9.2] L3 doc-no-inline-changelog exempts the root CHANGELOG.md and record docs", async () => {
	const found = await runLive(
		resolveDocNoInlineChangelog,
		"core/doc-no-inline-changelog",
		{
			worktree: {
				"CHANGELOG.md": "# Changelog\n\nUpdated on 2026-01-01: a.\n",
				"docs/HISTORY/2026-11-08.md":
					"# History\n\nUpdated on 2026-01-01: a.\n",
			},
			staged: ["CHANGELOG.md", "docs/HISTORY/2026-11-08.md"],
		},
	);
	assert.deepEqual(found, []);
});

test("[§4.9.2 EC-1] L3 doc-router-leaf flags a router that holds a paragraph", async () => {
	const found = await runLive(resolveDocRouterLeaf, "core/doc-router-leaf", {
		worktree: {
			"docs/PLAN.md": "# Plan\n\nA paragraph of prose.\n\nAnother paragraph.\n",
			"docs/PLAN/01-A.md": "# A\n",
		},
		staged: ["docs/PLAN.md"],
	});
	assert.ok(found.length > 0);
	assert.equal(found[0]?.ruleId, "core/doc-router-leaf");
});

test("[§4.9.2] L3 doc-router-leaf judges the router when only a leaf is staged and skips a folder with no router", async () => {
	const withRouter = await runLive(
		resolveDocRouterLeaf,
		"core/doc-router-leaf",
		{
			worktree: {
				"docs/PLAN.md": "# Plan\n\nProse one.\n\nProse two.\n",
				"docs/PLAN/01-A.md": "# A\n",
			},
			staged: ["docs/PLAN/01-A.md"],
		},
	);
	assert.ok(withRouter.length > 0);
	const orphan = await runLive(resolveDocRouterLeaf, "core/doc-router-leaf", {
		worktree: { "docs/SOLO/deep.md": "# Deep\n" },
		staged: ["docs/SOLO/deep.md"],
	});
	assert.deepEqual(orphan, []);
});

test("[§4.9.2] L3 doc-single-owner flags a sentence of twelve words in two docs", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			"docs/guide.md": `# Guide\n\n${SHARED}\n`,
			"docs/other.md": `# Other\n\n${SHARED}\n`,
		},
		staged: ["docs/guide.md", "docs/other.md"],
	});
	assert.equal(found.length, 1);
	assert.match(found[0]?.message ?? "", /repeats/);
});

test("[§4.9.2] L3 doc-single-owner compares a staged doc with an unstaged doc on disk", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			"docs/guide.md": `# Guide\n\n${SHARED}\n`,
			"docs/other.md": `# Other\n\n${SHARED}\n`,
			"docs/third.md": "# Third\n\nNothing shared here.\n",
		},
		staged: ["docs/guide.md"],
	});
	assert.equal(found.length, 1);
});

test("[§4.9.2] L3 doc-single-owner ignores a repeat between two unstaged docs", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			"docs/guide.md": "# Guide\n\nOnly this.\n",
			"docs/other.md": `# Other\n\n${SHARED}\n`,
			"docs/third.md": `# Third\n\n${SHARED}\n`,
		},
		staged: ["docs/guide.md"],
	});
	assert.deepEqual(found, []);
});

test("[§4.9.1] L3 doc-single-owner never treats the managed AGENTS.md as an owner", async () => {
	const found = await runLive(resolveDocSingleOwner, "core/doc-single-owner", {
		worktree: {
			"AGENTS.md": `# Agents\n\n${SHARED}\n`,
			"docs/other.md": `# Other\n\n${SHARED}\n`,
		},
		staged: ["AGENTS.md"],
	});
	assert.deepEqual(found, []);
});
