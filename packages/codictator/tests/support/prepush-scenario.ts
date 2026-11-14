// SPEC §4.3.2: the rebased-branch shape BUG-0092 needs. A branch is pushed
// once, the default branch then advances, and the branch is rebased onto it
// with one new commit of its own. The hook runs before the force-push, so
// @{push} still names the pre-rebase tip. The secret vector is assembled
// from two literals so this committed source holds no live-pattern literal.
import type { BareRepo, TempRepo } from "./temp-repo.ts";

export const PREPUSH_VECTOR = ["sk-dogfood-rejected-", "0123456789abcdef"].join(
	"",
);

export interface PrePushScenario {
	// Put the secret vector in the commit merged into the default branch.
	readonly mainSecret: boolean;
	// Put the secret vector in the branch's own new commit.
	readonly ownSecret: boolean;
	// Point refs/remotes/origin/HEAD at the default branch.
	readonly setHead: boolean;
}

function leak(secret: boolean): string {
	return secret ? `const key = "${PREPUSH_VECTOR}";\n` : "const key = '';\n";
}

export function buildRebasedBranch(
	repo: TempRepo,
	host: BareRepo,
	scenario: PrePushScenario,
): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
	repo.writeFile("base.txt", "base\n");
	repo.commit("base state");
	repo.git(["remote", "add", "origin", host.dir]);
	repo.git(["push", "-u", "origin", "main"]);
	if (scenario.setHead) {
		repo.git(["remote", "set-head", "origin", "main"]);
	}
	repo.git(["checkout", "-b", "feat"]);
	repo.writeFile("feat-one.txt", "first branch commit\n");
	repo.commit("branch commit one");
	repo.git(["push", "-u", "origin", "feat"]);
	repo.git(["checkout", "main"]);
	repo.writeFile("main-fix.txt", leak(scenario.mainSecret));
	repo.commit("fix landed on the default branch");
	repo.git(["push", "origin", "main"]);
	repo.git(["checkout", "feat"]);
	repo.git(["rebase", "main"]);
	repo.writeFile("own.txt", leak(scenario.ownSecret));
	repo.commit("branch commit after the rebase");
}
