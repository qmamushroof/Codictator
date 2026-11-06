// SPEC §4.3.2 + BUG-0044: `verify --base/--head` scopes the range diff, and
// a ranged deletion has no worktree content. Listing it scopes enforcer
// disk reads at a missing path, so push-event `ci verify` fail-closes on
// any commit that deletes a file (same class as BUG-0041/0043).
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveVerifyScope } from "../../../src/cli/evaluate.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

test("[§4.3.2] verify range scope excludes ranged deletions (BUG-0044)", async () => {
	// The victim exists at base and is deleted at head, so the range
	// carries a deletion; the keeper change keeps the scope non-empty so
	// the assertion pins exclusion, not an empty scope.
	const repo = createTempRepo({
		"victim.txt": "remove me\n",
		"keeper.txt": "stays\n",
	});
	try {
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		repo.git(["rm", "victim.txt"]);
		repo.writeFile("keeper.txt", "stays\nmore\n");
		repo.commit("drop the victim file");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const scope = await resolveVerifyScope(ports.value, {
			staged: false,
			all: false,
			base,
			head,
			layer: undefined,
		});
		assert.equal(scope.ok, true);
		if (!scope.ok) {
			return;
		}
		assert.ok(!scope.value.files.includes("victim.txt"));
		assert.ok(scope.value.files.includes("keeper.txt"));
	} finally {
		repo.cleanup();
	}
});
