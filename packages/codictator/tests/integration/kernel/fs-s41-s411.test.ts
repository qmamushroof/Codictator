import { strict as assert } from "node:assert";

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
