// SPEC §10.2: self-test for the in-memory Fs support.
import { strict as assert } from "node:assert";
import test from "node:test";
import { FakeFs } from "./fake-fs.ts";

test("[§10.2] fake fs reads back seeded text and bytes", async () => {
	const fs = new FakeFs();
	fs.seedText("docs/a.txt", "hello");
	const text = await fs.readText("docs/a.txt");
	assert.equal(text.ok, true);
	if (!text.ok) {
		return;
	}
	assert.equal(text.value, "hello");
	const raw = await fs.read("docs/a.txt");
	assert.equal(raw.ok, true);
	if (!raw.ok) {
		return;
	}
	assert.deepEqual(raw.value, new TextEncoder().encode("hello"));
});

test("[§10.2] fake fs writes, appends and stats files", async () => {
	const fs = new FakeFs();
	const written = await fs.write("out.txt", new TextEncoder().encode("ab"));
	assert.equal(written.ok, true);
	const appended = await fs.append("out.txt", new TextEncoder().encode("cd"));
	assert.equal(appended.ok, true);
	const text = await fs.readText("out.txt");
	assert.equal(text.ok, true);
	if (!text.ok) {
		return;
	}
	assert.equal(text.value, "abcd");
	const stat = await fs.stat("out.txt");
	assert.equal(stat.ok, true);
	if (!stat.ok) {
		return;
	}
	assert.equal(stat.value.isFile, true);
	assert.equal(stat.value.size, 4);
	const exists = await fs.exists("out.txt");
	assert.deepEqual(exists, { ok: true, value: true });
});

test("[§10.2] fake fs lists immediate children in sorted order", async () => {
	const fs = new FakeFs();
	fs.seedText("src/b.ts", "b");
	fs.seedText("src/a.ts", "a");
	fs.seedText("src/nested/c.ts", "c");
	const top = await fs.list("");
	assert.deepEqual(top, { ok: true, value: ["src"] });
	const inner = await fs.list("src");
	assert.deepEqual(inner, { ok: true, value: ["a.ts", "b.ts", "nested"] });
});

test("[§10.2] fake fs globs with star and globstar", async () => {
	const fs = new FakeFs();
	fs.seedText("src/a.ts", "a");
	fs.seedText("src/nested/b.ts", "b");
	fs.seedText("docs/a.md", "docs");
	const all = await fs.glob("**/*.ts", "");
	assert.equal(all.ok, true);
	if (!all.ok) {
		return;
	}
	assert.deepEqual(all.value, ["src/a.ts", "src/nested/b.ts"]);
	const direct = await fs.glob("*.ts", "src");
	assert.equal(direct.ok, true);
	if (!direct.ok) {
		return;
	}
	assert.deepEqual(direct.value, ["src/a.ts"]);
});

test("[§10.2] fake fs removes files and answers real errors when armed", async () => {
	const fs = new FakeFs();
	fs.seedText("gone.txt", "x");
	const removed = await fs.remove("gone.txt");
	assert.equal(removed.ok, true);
	const after = await fs.exists("gone.txt");
	assert.deepEqual(after, { ok: true, value: false });
	fs.failNext({
		code: "CDX-E701",
		message: "outside the repo",
		remediation: "write inside the repo",
	});
	const denied = await fs.write("elsewhere.txt", new Uint8Array(0));
	assert.equal(denied.ok, false);
	if (denied.ok) {
		return;
	}
	assert.equal(denied.error.code, "CDX-E701");
	await assert.rejects(fs.read("never-seeded.txt"));
});
