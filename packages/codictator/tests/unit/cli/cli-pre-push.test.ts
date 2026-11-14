// SPEC §4.3.2 + BUG-0043: pre-push judges the `@{push}..HEAD` diff, and a
// pushed deletion has no worktree content. Listing it scopes enforcer disk
// reads at a missing path, so the gate fail-closes and a commit that only
// deletes a file can never be pushed. The names listing carries the same
// --diff-filter=ACMR class as the BUG-0041 stagedFiles fix.
import { strict as assert } from "node:assert";
import test from "node:test";
import { handleGitHook } from "../../../src/cli/git-hook.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import {
	buildRebasedBranch,
	PREPUSH_VECTOR,
	type PrePushScenario,
} from "../../support/prepush-scenario.ts";
import { createBareRepo, createTempRepo } from "../../support/temp-repo.ts";

function req(args: ReadonlyArray<string>, cwd: string): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

test("[§4.3.2] pre-push allows a pushed deletion (BUG-0043)", async () => {
	// The victim exists at the push base and is deleted at HEAD, so the
	// pushed range carries a deletion; the keeper change keeps the scope
	// non-empty so allow means the deletion left the scope, not the gate.
	const repo = createTempRepo();
	const host = createBareRepo();
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "unknown",
				packs: [],
				harnesses: ["muse-code", "opencode"],
			}),
		);
		repo.writeFile("victim.txt", "remove me\n");
		repo.writeFile("keeper.txt", "stays\n");
		repo.commit("base state");
		repo.git(["remote", "add", "origin", host.dir]);
		repo.git(["push", "-u", "origin", "main"]);
		repo.git(["rm", "victim.txt"]);
		repo.writeFile("keeper.txt", "stays\nmore\n");
		repo.commit("drop the victim file");
		const ran = await handleGitHook(req(["pre-push"], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 0);
	} finally {
		repo.cleanup();
		host.cleanup();
	}
});

async function prePushCode(scenario: PrePushScenario): Promise<number> {
	const repo = createTempRepo();
	const host = createBareRepo();
	try {
		buildRebasedBranch(repo, host, scenario);
		const ran = await handleGitHook(req(["pre-push"], repo.dir));
		assert.equal(ran.ok, true);
		return ran.value;
	} finally {
		repo.cleanup();
		host.cleanup();
	}
}

test("[§4.3.2] pre-push ignores commits already on the default branch after a rebase (BUG-0092)", async () => {
	const code = await prePushCode({
		mainSecret: true,
		ownSecret: false,
		setHead: true,
	});
	assert.equal(code, 0);
});

test("[§4.3.2] pre-push still judges the branch's own new commit (BUG-0092)", async () => {
	const code = await prePushCode({
		mainSecret: false,
		ownSecret: true,
		setHead: true,
	});
	assert.equal(code, 1);
});

test("[§4.3.2] pre-push fails closed to @{push}..HEAD without origin/HEAD (BUG-0092)", async () => {
	const code = await prePushCode({
		mainSecret: true,
		ownSecret: false,
		setHead: false,
	});
	assert.equal(code, 1);
});

test("[§4.3.2] pre-push fails closed to @{push}..HEAD when a merge sits in the range (BUG-0092)", async () => {
	const repo = createTempRepo();
	const host = createBareRepo();
	try {
		buildRebasedBranch(repo, host, {
			mainSecret: true,
			ownSecret: false,
			setHead: true,
		});
		repo.git(["checkout", "-b", "side"]);
		repo.writeFile("side.txt", "side work\n");
		repo.commit("side commit");
		repo.git(["checkout", "feat"]);
		repo.git(["merge", "--no-ff", "-m", "merge side", "side"]);
		const ran = await handleGitHook(req(["pre-push"], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 1);
	} finally {
		repo.cleanup();
		host.cleanup();
	}
});

test("[§4.3.2] pre-push fails closed to @{push}..HEAD when the oldest own commit is a root (BUG-0092)", async () => {
	const repo = createTempRepo();
	const host = createBareRepo();
	try {
		buildRebasedBranch(repo, host, {
			mainSecret: false,
			ownSecret: false,
			setHead: true,
		});
		repo.git(["config", "push.default", "upstream"]);
		repo.git(["checkout", "--orphan", "unrelated"]);
		// Keep the config file in the worktree; drop every other tracked file.
		repo.git([
			"rm",
			"-rf",
			"--quiet",
			"base.txt",
			"main-fix.txt",
			"feat-one.txt",
			"own.txt",
		]);
		repo.git(["config", "branch.unrelated.remote", "origin"]);
		repo.git(["config", "branch.unrelated.merge", "refs/heads/main"]);
		repo.writeFile("leak.txt", `const key = "${PREPUSH_VECTOR}";\n`);
		repo.commit("root commit of an unrelated history");
		const ran = await handleGitHook(req(["pre-push"], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 1);
	} finally {
		repo.cleanup();
		host.cleanup();
	}
});
