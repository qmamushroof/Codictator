import { strict as assert } from "node:assert";

import { mkdtempSync, readdirSync, rmSync } from "node:fs";

import { symlink } from "node:fs/promises";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { NodeFs, type NodeFsOptions } from "../../../src/kernel/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

function makeFs(root: string, options: NodeFsOptions = {}): Promise<NodeFs> {
	return NodeFs.create({ root, ...options }).then((made) => {
		if (!made.ok) {
			assert.fail(made.error.message);
		}
		return made.value;
	});
}

test("[§4.1 EC-1] write through a symlink escaping the repo fails CDX-E701", async (t) => {
	const repo = createTempRepo({ "docs/keep.txt": "keep" });
	t.after(() => {
		repo.cleanup();
	});
	const outside = mkdtempSync(path.join(tmpdir(), "codictator-outside-"));
	t.after(() => {
		rmSync(outside, { recursive: true, force: true });
	});
	// SPEC §4.1.1: the OS temp dir is an allowed zone, so pin the port's temp
	// root to a dedicated dir and keep the escape target outside of it.
	const allowed = mkdtempSync(path.join(tmpdir(), "codictator-allowed-"));
	t.after(() => {
		rmSync(allowed, { recursive: true, force: true });
	});
	const fs = await makeFs(repo.dir, { tempDir: allowed });
	const linkType = process.platform === "win32" ? "junction" : "dir";
	await symlink(outside, path.join(repo.dir, "docs", "leak"), linkType);
	const written = await fs.write(
		"docs/leak/evil.txt",
		new TextEncoder().encode("evil"),
	);
	assert.equal(written.ok, false);
	if (!written.ok) {
		assert.equal(written.error.code, "CDX-E701");
	}
	assert.deepEqual(readdirSync(outside), []);
});

test("[§4.1 EC-1] dotdot write escaping the root fails CDX-E701", async (t) => {
	const repo = createTempRepo({ "keep.txt": "keep" });
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const written = await fs.write(
		"../evil.txt",
		new TextEncoder().encode("evil"),
	);
	assert.equal(written.ok, false);
	if (!written.ok) {
		assert.equal(written.error.code, "CDX-E701");
	}
	const listed = await fs.list(".");
	assert.equal(listed.ok, true);
	if (listed.ok) {
		assert.ok(!listed.value.includes("evil.txt"));
	}
});

test("[§4.1.1] write through a symlink into the OS temp dir is allowed", async (t) => {
	const repo = createTempRepo({ "docs/keep.txt": "keep" });
	t.after(() => {
		repo.cleanup();
	});
	const allowed = mkdtempSync(path.join(tmpdir(), "codictator-allowed-"));
	t.after(() => {
		rmSync(allowed, { recursive: true, force: true });
	});
	const fs = await makeFs(repo.dir, { tempDir: allowed });
	const linkType = process.platform === "win32" ? "junction" : "dir";
	await symlink(allowed, path.join(repo.dir, "docs", "work"), linkType);
	const written = await fs.write(
		"docs/work/note.txt",
		new TextEncoder().encode("note"),
	);
	assert.equal(written.ok, true);
	assert.deepEqual(readdirSync(allowed), ["note.txt"]);
});

test("[§4.1.1] append joins bytes and missing parent dirs are created", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
	assert.equal(
		await fs.append("deep/nested/f.txt", encode("a")).then((r) => r.ok),
		true,
	);
	assert.equal(
		await fs.append("deep/nested/f.txt", encode("b")).then((r) => r.ok),
		true,
	);
	const seen = await fs.readText("deep/nested/f.txt");
	assert.equal(seen.ok, true);
	if (seen.ok) {
		assert.equal(seen.value, "ab");
	}
});

test("[§4.1.1] stat list glob exists realpath and remove agree", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
	assert.equal(await fs.write("a.txt", encode("x")).then((r) => r.ok), true);
	assert.equal(await fs.write("sub/b.md", encode("y")).then((r) => r.ok), true);
	const st = await fs.stat("a.txt");
	assert.equal(st.ok, true);
	if (st.ok) {
		assert.equal(st.value.isFile, true);
		assert.equal(st.value.isDirectory, false);
		assert.equal(st.value.size, 1);
	}
	const listed = await fs.list(".");
	assert.equal(listed.ok, true);
	if (listed.ok) {
		assert.ok(listed.value.includes("a.txt"));
		assert.ok(listed.value.includes("sub"));
	}
	const matched = await fs.glob("**/*.md", ".");
	assert.equal(matched.ok, true);
	if (matched.ok) {
		assert.deepEqual(matched.value, ["sub/b.md"]);
	}
	const present = await fs.exists("a.txt");
	assert.equal(present.ok, true);
	if (present.ok) {
		assert.equal(present.value, true);
	}
	const missing = await fs.exists("nope.txt");
	assert.equal(missing.ok, true);
	if (missing.ok) {
		assert.equal(missing.value, false);
	}
	const real = await fs.realpath("a.txt");
	assert.equal(real.ok, true);
	if (real.ok) {
		assert.equal(real.value, "a.txt");
	}
	assert.equal(await fs.remove("a.txt").then((r) => r.ok), true);
	const gone = await fs.exists("a.txt");
	assert.equal(gone.ok, true);
	if (gone.ok) {
		assert.equal(gone.value, false);
	}
});

test("[§4.1.1] missing files report E903 and root paths refuse writes", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	for (const result of [
		await fs.read("nope.txt"),
		await fs.readText("nope.txt"),
		await fs.stat("nope.txt"),
		await fs.list("nope"),
		await fs.realpath("nope.txt"),
	]) {
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E903");
		}
	}
	const bytes = new TextEncoder().encode("x");
	for (const result of [
		await fs.write(".", bytes),
		await fs.append(".", bytes),
		await fs.remove("."),
		await fs.read("../outside.txt"),
	]) {
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E701");
		}
	}
});
