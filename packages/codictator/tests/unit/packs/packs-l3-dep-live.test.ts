// SPEC §4.8.5 + §4.8.4 (BUG-0107): the four dependency rules the L3 stage
// probe silenced judge the staged manifest. The lockfile and a new
// dependency's reason are read from the tree and the staged history entry;
// advisories and deprecation are read hermetically from the registry
// snapshot a repo carries at .codictator/cache/registry/npm.json (§7.12).
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	resolveDepLockfile,
	resolveDepNewNeedsReason,
	resolveDepNoDeprecated,
	resolveDepNoVulnerable,
} from "../../../src/features/packs/enforcers/deps-live-guards.ts";
import { runLive } from "../../support/l3-live-scenario.ts";

const SNAPSHOT_PATH = ".codictator/cache/registry/npm.json";

function manifest(deps: Record<string, string>): string {
	return JSON.stringify({ name: "mx", version: "0.0.0", dependencies: deps });
}

function snapshot(
	advisories: Record<string, Array<string>>,
	versions: Record<string, { deprecated?: boolean }>,
): string {
	return JSON.stringify({
		version: 1,
		ecosystem: "npm",
		fetchedAt: "2026-11-21T00:00:00.000Z",
		packages: { "left-pad": { versions } },
		advisories,
	});
}

test("[§4.8.5] L3 dep-lockfile flags a manifest with dependencies and no lockfile", async () => {
	const found = await runLive(resolveDepLockfile, "core/dep-lockfile", {
		worktree: { "package.json": manifest({ "left-pad": "1.3.0" }) },
		staged: ["package.json"],
	});
	assert.equal(found.length, 1);
	assert.equal(found[0]?.path, "package.json");
});

test("[§4.8.5] L3 dep-lockfile accepts a root lockfile that matches the pins and a manifest with no dependencies", async () => {
	const lock = JSON.stringify({
		lockfileVersion: 3,
		packages: {
			"": { dependencies: { "left-pad": "1.3.0" } },
			"node_modules/left-pad": { version: "1.3.0" },
		},
	});
	const synced = await runLive(resolveDepLockfile, "core/dep-lockfile", {
		worktree: {
			"package-lock.json": lock,
			"packages/a/package.json": manifest({ "left-pad": "1.3.0" }),
		},
		staged: ["packages/a/package.json"],
	});
	assert.deepEqual(synced, []);
	const bare = await runLive(resolveDepLockfile, "core/dep-lockfile", {
		worktree: { "package.json": manifest({}) },
		staged: ["package.json"],
	});
	assert.deepEqual(bare, []);
});

test("[§4.8.5] L3 dep-lockfile flags a lockfile that pins another version than the manifest", async () => {
	const lock = JSON.stringify({
		lockfileVersion: 3,
		packages: { "node_modules/left-pad": { version: "1.2.0" } },
	});
	const found = await runLive(resolveDepLockfile, "core/dep-lockfile", {
		worktree: {
			"package-lock.json": lock,
			"package.json": manifest({ "left-pad": "1.3.0" }),
		},
		staged: ["package.json"],
	});
	assert.equal(found.length, 1);
	assert.match(found[0]?.message ?? "", /left-pad/);
});

test("[§4.8.4] L3 dep-no-vulnerable flags a pinned version the snapshot lists an advisory for", async () => {
	const worktree = {
		"package.json": manifest({ "left-pad": "1.3.0" }),
		[SNAPSHOT_PATH]: snapshot({ "left-pad@1.3.0": ["GHSA-x"] }, {}),
	};
	const found = await runLive(
		resolveDepNoVulnerable,
		"core/dep-no-vulnerable",
		{
			worktree,
			staged: ["package.json"],
		},
	);
	assert.equal(found.length, 1);
	assert.match(found[0]?.message ?? "", /GHSA-x/);
	const other = await runLive(
		resolveDepNoVulnerable,
		"core/dep-no-vulnerable",
		{
			worktree: {
				...worktree,
				"package.json": manifest({ "left-pad": "1.4.0" }),
			},
			staged: ["package.json"],
		},
	);
	assert.deepEqual(other, []);
});

test("[§4.8.4] L3 dep-no-deprecated flags a pinned version the snapshot marks deprecated", async () => {
	const worktree = {
		"package.json": manifest({ "left-pad": "1.3.0" }),
		[SNAPSHOT_PATH]: snapshot({}, { "1.3.0": { deprecated: true } }),
	};
	const found = await runLive(
		resolveDepNoDeprecated,
		"core/dep-no-deprecated",
		{
			worktree,
			staged: ["package.json"],
		},
	);
	assert.equal(found.length, 1);
	const clean = await runLive(
		resolveDepNoDeprecated,
		"core/dep-no-deprecated",
		{
			worktree: { ...worktree, [SNAPSHOT_PATH]: snapshot({}, { "1.3.0": {} }) },
			staged: ["package.json"],
		},
	);
	assert.deepEqual(clean, []);
});

test("[§4.8.4] L3 dependency verdicts stay quiet with no snapshot on disk", async () => {
	const found = await runLive(
		resolveDepNoVulnerable,
		"core/dep-no-vulnerable",
		{
			worktree: { "package.json": manifest({ "left-pad": "1.3.0" }) },
			staged: ["package.json"],
		},
	);
	assert.deepEqual(found, []);
});

function entry(deps: string): string {
	return `# History\n\n## 2026-11-21 · chore(deps): add\n- **Kind:** deps\n- **Task:** T-0001\n- **Why:** w\n- **Deps:** ${deps}\n`;
}

test("[§4.8.5] L3 dep-new-needs-reason flags an added dependency with no Deps reason line", async () => {
	const found = await runLive(
		resolveDepNewNeedsReason,
		"core/dep-new-needs-reason",
		{
			worktree: { "package.json": manifest({ "left-pad": "1.3.0" }) },
			staged: ["package.json"],
			head: { "package.json": manifest({}) },
		},
	);
	assert.equal(found.length, 1);
	assert.match(found[0]?.message ?? "", /left-pad/);
});

test("[§4.8.5] L3 dep-new-needs-reason accepts a staged history Deps line with reason and rung", async () => {
	const found = await runLive(
		resolveDepNewNeedsReason,
		"core/dep-new-needs-reason",
		{
			worktree: {
				"package.json": manifest({ "left-pad": "1.3.0" }),
				"docs/HISTORY/2026-11-21.md": entry(
					"+ left-pad@1.3.0 — pads strings the platform cannot — rung 3",
				),
			},
			staged: ["package.json", "docs/HISTORY/2026-11-21.md"],
			head: { "package.json": manifest({}) },
		},
	);
	assert.deepEqual(found, []);
});

test("[§4.8.5] L3 dep-new-needs-reason ignores a dependency HEAD already carries", async () => {
	const found = await runLive(
		resolveDepNewNeedsReason,
		"core/dep-new-needs-reason",
		{
			worktree: { "package.json": manifest({ "left-pad": "1.3.0" }) },
			staged: ["package.json"],
			head: { "package.json": manifest({ "left-pad": "1.2.0" }) },
		},
	);
	assert.deepEqual(found, []);
});
