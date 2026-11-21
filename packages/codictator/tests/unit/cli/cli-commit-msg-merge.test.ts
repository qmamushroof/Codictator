// SPEC §4.9.3 + BUG-0079: merge commits are exempt from the one-entry-per-
// commit rule. During a merge git stages the merged branch's own history
// entry, so judging staged minus HEAD counted it as added by the merge and
// blocked it; a normal commit without an entry must keep blocking.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleGitHook } from "../../../src/cli/git-hook.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

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

const ENTRY = [
	"## 2026-11-21 · fix(demo): branch change",
	"- **Kind:** code",
	"- **Task:** T-0001",
	"- **Why:** the branch records its own entry.",
	"- **What went wrong:** none",
	"- **Trade-offs:** none",
	"- **Lessons:** none",
	"",
].join("\n");

function seed(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
	repo.writeFile("docs/HISTORY/2026-11-21.md", "# History — 2026-11-21\n");
	repo.writeFile("src/base.ts", "export const base = 1;\n");
	repo.commit("chore: base");
}

test("[§4.9.3] commit-msg passes a merge commit whose second parent carries its own history entry (BUG-0079)", async () => {
	const repo = createTempRepo();
	try {
		seed(repo);
		repo.git(["checkout", "-b", "feature"]);
		repo.writeFile("src/feature.ts", "export const feature = 1;\n");
		repo.writeFile(
			"docs/HISTORY/2026-11-21.md",
			`# History — 2026-11-21\n\n${ENTRY}`,
		);
		repo.commit("fix(demo): branch change");
		repo.git(["checkout", "main"]);
		repo.writeFile("src/other.ts", "export const other = 1;\n");
		repo.commit("chore: diverge main");
		repo.git(["merge", "--no-ff", "--no-commit", "feature"]);
		const msgFile = path.join(repo.dir, "COMMIT_EDITMSG");
		writeFileSync(msgFile, "Merge branch 'feature'\n", "utf8");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
		assert.match(readFileSync(msgFile, "utf8"), /^Codictator-L3: /m);
	} finally {
		repo.cleanup();
	}
});

test("[§4.9.3] commit-msg still blocks a normal commit without a history entry", async () => {
	const repo = createTempRepo();
	try {
		seed(repo);
		repo.writeFile("src/change.ts", "export const change = 1;\n");
		const msgFile = path.join(repo.dir, "COMMIT_EDITMSG");
		writeFileSync(msgFile, "fix(demo): no entry\n", "utf8");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.notEqual(ran.value, 0);
		}
		assert.doesNotMatch(readFileSync(msgFile, "utf8"), /Codictator-L3/);
	} finally {
		repo.cleanup();
	}
});
