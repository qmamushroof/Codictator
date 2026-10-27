// SPEC §10.2: self-test for the in-memory Git support.
import { strict as assert } from "node:assert";
import test from "node:test";
import { FakeGit } from "./fake-git.ts";

test("[§10.2] fake git answers seeded state with sorted staged files", async () => {
	const git = new FakeGit();
	git.setStaged(["b.ts", "a.ts"]);
	git.setDiff("base", "head", "diff text");
	const staged = await git.stagedFiles();
	assert.deepEqual(staged, { ok: true, value: ["a.ts", "b.ts"] });
	const diff = await git.diff("base", "head");
	assert.deepEqual(diff, { ok: true, value: "diff text" });
	const clean = await git.isClean();
	assert.deepEqual(clean, { ok: true, value: true });
});

test("[§10.2] fake git answers empty text for unseeded queries", async () => {
	const git = new FakeGit();
	assert.deepEqual(await git.show("head", "missing.ts"), {
		ok: true,
		value: "",
	});
	assert.deepEqual(await git.config("unknown.key"), { ok: true, value: "" });
	assert.deepEqual(await git.log("head~1..head"), { ok: true, value: "" });
});

test("[§10.2] fake git fails the next call with the armed error", async () => {
	const git = new FakeGit();
	git.failNext({
		code: "CDX-E703",
		message: "git missing",
		remediation: "install git",
	});
	const head = await git.head();
	assert.equal(head.ok, false);
	if (head.ok) {
		return;
	}
	assert.equal(head.error.code, "CDX-E703");
	const root = await git.root();
	assert.equal(root.ok, true);
});
