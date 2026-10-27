// SPEC §4.1.1 and §4.1.3 EC-1, EC-2, EC-3, EC-7, EC-8, EC-12: integration
// tests for the real Fs port against the real OS. Each test builds a throwaway
// git repo (SPEC §10.2) and removes it afterwards; nothing reaches the
// network and nothing touches the enclosing checkout.
import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	NodeFs,
	type NodeFsOptions,
	normalizeText,
	sha256Text,
	stableStringify,
} from "../../../src/kernel/index.ts";
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

test("[§4.1 EC-2] dotdot path normalising inside the repo is allowed", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const written = await fs.write(
		"sub/../inner.txt",
		new TextEncoder().encode("inner"),
	);
	assert.equal(written.ok, true);
	const seen = await fs.readText("inner.txt");
	assert.equal(seen.ok, true);
	if (seen.ok) {
		assert.equal(seen.value, "inner");
	}
});

test("[§4.1 EC-3] case-variant path resolves to the existing file", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const written = await fs.write("Case.txt", new TextEncoder().encode("mixed"));
	assert.equal(written.ok, true);
	const seen = await fs.readText("CASE.TXT");
	if (process.platform === "win32" || process.platform === "darwin") {
		assert.equal(seen.ok, true);
		if (seen.ok) {
			assert.equal(seen.value, "mixed");
		}
	} else {
		assert.equal(seen.ok, false);
	}
});

test("[§4.1 EC-7] same JSON value written twice is byte-identical", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const text = stableStringify({ b: 1, a: 2 });
	const bytes = new TextEncoder().encode(text);
	assert.equal(await fs.write("data/out.json", bytes).then((r) => r.ok), true);
	const first = await fs.read("data/out.json");
	assert.equal(await fs.write("data/out.json", bytes).then((r) => r.ok), true);
	const second = await fs.read("data/out.json");
	assert.equal(first.ok, true);
	assert.equal(second.ok, true);
	if (first.ok && second.ok) {
		assert.deepEqual(first.value, second.value);
		assert.equal(new TextDecoder().decode(first.value), text);
	}
});

test("[§4.1 EC-8] CRLF file hashes like its LF twin", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
	assert.equal(
		await fs.write("crlf.txt", encode("a\r\nb\r\n")).then((r) => r.ok),
		true,
	);
	assert.equal(
		await fs.write("lf.txt", encode("a\nb\n")).then((r) => r.ok),
		true,
	);
	const crlf = await fs.readText("crlf.txt");
	const lf = await fs.readText("lf.txt");
	assert.equal(crlf.ok, true);
	assert.equal(lf.ok, true);
	if (crlf.ok && lf.ok) {
		assert.equal(normalizeText(crlf.value), normalizeText(lf.value));
		assert.equal(sha256Text(crlf.value), sha256Text(lf.value));
	}
});

test("[§4.1 EC-12] non-UTF-8 file reads as bytes and reports encoding", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const raw = new Uint8Array([0xff, 0xd8, 0xff]);
	assert.equal(await fs.write("assets/blob.bin", raw).then((r) => r.ok), true);
	const bytes = await fs.read("assets/blob.bin");
	assert.equal(bytes.ok, true);
	if (bytes.ok) {
		assert.deepEqual(bytes.value, raw);
	}
	const text = await fs.readText("assets/blob.bin");
	assert.equal(text.ok, false);
	if (!text.ok) {
		assert.match(text.error.message, /binary-or-unknown-encoding/);
	}
});

test("[§4.1.1] UTF-8 BOM is stripped from text reads", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	const raw = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
	assert.equal(await fs.write("bom.txt", raw).then((r) => r.ok), true);
	const text = await fs.readText("bom.txt");
	assert.equal(text.ok, true);
	if (text.ok) {
		assert.equal(text.value, "hi");
	}
	const bytes = await fs.read("bom.txt");
	assert.equal(bytes.ok, true);
	if (bytes.ok) {
		assert.deepEqual(bytes.value, raw);
	}
});

test("[§4.1.1] writes are atomic with no temp leftovers", async (t) => {
	const repo = createTempRepo({});
	t.after(() => {
		repo.cleanup();
	});
	const fs = await makeFs(repo.dir);
	assert.equal(
		await fs
			.write("a.txt", new TextEncoder().encode("atomic"))
			.then((r) => r.ok),
		true,
	);
	const listed = await fs.list(".");
	assert.equal(listed.ok, true);
	if (listed.ok) {
		assert.ok(!listed.value.some((name) => name.startsWith(".codictator-")));
		assert.ok(listed.value.includes("a.txt"));
	}
	const seen = await fs.readText("a.txt");
	assert.equal(seen.ok, true);
	if (seen.ok) {
		assert.equal(seen.value, "atomic");
	}
});

test("[§4.1.1] repo root resolves by .git find-up from a sub-directory", async (t) => {
	const repo = createTempRepo({ "top.txt": "top" });
	t.after(() => {
		repo.cleanup();
	});
	const made = await NodeFs.create({
		startDir: path.join(repo.dir, "nested", "deep"),
	});
	if (!made.ok) {
		assert.fail(made.error.message);
	}
	const seen = await made.value.readText("top.txt");
	assert.equal(seen.ok, true);
	if (seen.ok) {
		assert.equal(seen.value, "top");
	}
});
