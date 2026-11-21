// SPEC §5.11 + §4.14.4 (BUG-0107): core/repo-hygiene judges the staged paths
// for committed build output, and core/conventional-commit judges the
// commit message the commit-msg hook receives.
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveRepoHygiene } from "../../../src/features/packs/enforcers/repo-hygiene.ts";
import { checkCommitMessage } from "../../../src/features/records/commit-subject.ts";
import { runLive } from "../../support/l3-live-scenario.ts";

function hygiene(
	worktree: Record<string, string>,
	staged: ReadonlyArray<string>,
) {
	return runLive(resolveRepoHygiene, "core/repo-hygiene", { worktree, staged });
}

test("[§5.11] L3 repo-hygiene flags a staged path inside a build output directory", async () => {
	const found = await hygiene({ "dist/bundle.js": "x\n" }, ["dist/bundle.js"]);
	assert.equal(found.length, 1);
	assert.equal(found[0]?.path, "dist/bundle.js");
});

test("[§5.11] L3 repo-hygiene matches whole segments and leaves test trees and guardrail files alone", async () => {
	const staged = [
		"src/dist-info/a.ts",
		"tests/unit/coverage/a.test.ts",
		".codictator/bin/run.mjs",
		"src/a.ts",
	];
	const worktree = Object.fromEntries(staged.map((name) => [name, "x\n"]));
	assert.deepEqual(await hygiene(worktree, staged), []);
});

test("[§5.11] L3 repo-hygiene flags a staged .gitattributes that does not set text=auto eol=lf", async () => {
	const bad = await hygiene({ ".gitattributes": "*.png binary\n" }, [
		".gitattributes",
	]);
	assert.equal(bad.length, 1);
	const good = await hygiene({ ".gitattributes": "* text=auto eol=lf\n" }, [
		".gitattributes",
	]);
	assert.deepEqual(good, []);
});

test("[§5.11] commit-msg conventional-commit flags a subject with no type prefix", () => {
	const found = checkCommitMessage("wip stuff\n");
	assert.equal(found.length, 1);
	assert.equal(found[0]?.ruleId, "core/conventional-commit");
});

test("[§5.11] commit-msg conventional-commit accepts a typed subject with a scope and a body after a blank line", () => {
	assert.deepEqual(
		checkCommitMessage("feat(deps)!: add a thing\n\nbody text\n"),
		[],
	);
	assert.deepEqual(
		checkCommitMessage("# comment\nfix: repair it\n# another\n"),
		[],
	);
});

test("[§5.11] commit-msg conventional-commit flags a body with no blank line after the subject and an over-long subject", () => {
	assert.equal(checkCommitMessage("fix: repair it\nbody\n").length, 1);
	assert.equal(checkCommitMessage(`fix: ${"x".repeat(80)}\n`).length, 1);
});
