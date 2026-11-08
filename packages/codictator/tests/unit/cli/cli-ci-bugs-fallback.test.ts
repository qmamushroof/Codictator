// SPEC §4.9 EC-22 + BUG-0068: `ci verify` range scope falls back to
// tracked BUGS rows. The hook leg unions tracked docs/BUGS/ files into its
// scope (withTrackedBugsFallback), but the CI leg judged the base..head
// diff names only, so bugRegistryReal read zero BUGS rows and a fix task
// whose row was already fixed failed closed on unknown-row.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withTrackedBugsFallback } from "../../../src/cli/git-history.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function cliSource(name: string): string {
	return readFileSync(
		new URL(`../../../src/cli/${name}`, import.meta.url),
		"utf8",
	);
}

test("[§4.9 EC-22] ci verify range scope falls back to tracked BUGS rows for fix tasks", async () => {
	// The CI leg must apply the same tracked-BUGS fallback as the hook leg:
	// a range scope with no docs/BUGS/ file unions the tracked BUGS rows
	// before evaluateGateScope, so bugRegistryReal finds the fixed row.
	assert.ok(
		cliSource("ci.ts").includes("withTrackedBugsFallback"),
		"ci verify never falls back to tracked BUGS rows",
	);
	const fake = createFakePorts();
	fake.proc.when(
		["git", "ls-tree", "HEAD", "--name-only", "--", "docs/BUGS/"],
		{
			code: 0,
			stdout: "docs/BUGS/2026.md\n",
			stderr: "",
			timedOut: false,
			truncated: false,
		},
	);
	const scoped = await withTrackedBugsFallback(
		{ ...fake.ports, root: "/repo" },
		[".codictator/tasks/T-0011.json"],
	);
	assert.ok(
		scoped.includes("docs/BUGS/2026.md"),
		"gate scope misses the tracked BUGS row",
	);
});

test("[§4.9 EC-22] tracked BUGS fallback keeps the scope when git is unavailable", async () => {
	// Unit: when the tracked listing fails, the scope passes through
	// unchanged instead of fail-closing the gate.
	const fake = createFakePorts();
	fake.proc.whenMissing({
		code: 1,
		stdout: "",
		stderr: "fatal: not a git repository",
		timedOut: false,
		truncated: false,
	});
	const seen = await withTrackedBugsFallback({ ...fake.ports, root: "/repo" }, [
		"src/a.ts",
	]);
	assert.deepEqual(seen, ["src/a.ts"]);
});
