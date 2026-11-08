// SPEC §4.9 EC-22 + BUG-0068: `ci verify` range scope falls back to
// tracked BUGS rows in a real repo. The range diff carries only the
// changed file, so the gate scope misses the already-fixed BUGS row;
// the tracked fallback unions it back before bugRegistryReal judges.
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveVerifyScope } from "../../src/cli/evaluate.ts";
import { withTrackedBugsFallback } from "../../src/cli/git-history.ts";
import { portsFor } from "../../src/cli/shared.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[§4.9 EC-22] ci verify range scope falls back to tracked BUGS rows in a real repo", async () => {
	// The fix commit touches only src/a.ts, so the base..head diff names
	// no BUGS file; the fallback still scopes the tracked BUGS row.
	const repo = createTempRepo({
		"docs/BUGS/2026.md":
			"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n| BUG-0001 | fixed | sample row | 2026-01-01, none | none, fix: sample | packages/sample.test.ts |\n",
		"src/a.ts": "export const a = 1;\n",
	});
	try {
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		repo.writeFile("src/a.ts", "export const a = 2;\n");
		repo.commit("change a without touching BUGS");
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
		assert.ok(!scope.value.files.includes("docs/BUGS/2026.md"));
		const scoped = await withTrackedBugsFallback(
			ports.value,
			scope.value.files,
		);
		assert.ok(
			scoped.includes("docs/BUGS/2026.md"),
			"gate scope misses the tracked BUGS row",
		);
	} finally {
		repo.cleanup();
	}
});
