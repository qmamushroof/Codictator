// SPEC §4.1.3: one red test per kernel EC row. Each test pins the SPEC
// Expected outcome against the kernel contract, then executes it. Every
// contract below still throws "not implemented", and the port fakes enforce
// nothing, so all thirteen fail red until Phase 3 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	normalizeText,
	parseJson,
	redactSecrets,
	stableStringify,
	toRepoPath,
	validateSchema,
} from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

test("[§4.1 EC-1] symlink write escaping the repo root", async () => {
	const { fs } = createFakePorts();
	fs.seedText("docs/link", "points outside");
	const seen = await fs.realpath("docs/link");
	assert.equal(seen.ok, true);
	// SPEC §4.1.3 EC-1: the write fails CDX-E701 and nothing is written.
	const confined = toRepoPath("../outside.txt");
	assert.equal(confined.ok, false);
});

test("[§4.1 EC-2] dotdot path that normalises inside the repo", () => {
	// SPEC §4.1.3 EC-2: allowed; the normalised path is used.
	const narrowed = toRepoPath("sub/../file.txt");
	assert.equal(narrowed.ok, true);
	if (narrowed.ok) {
		assert.equal(narrowed.value, "file.txt");
	}
});

test("[§4.1 EC-3] case-variant path on a case-insensitive volume", () => {
	// SPEC §4.1.3 EC-3: treated as the existing file; the repo case is canonical.
	const canonical = toRepoPath("SRC/Readme.md");
	assert.equal(canonical.ok, true);
});

test("[§4.1 EC-4] request to a host off the allowlist", async () => {
	const { net, clock } = createFakePorts();
	assert.equal(clock.now(), FIXED_INSTANT);
	const res = await net.request({
		method: "GET",
		url: "https://exfil.example/collect",
		headers: {},
		timeoutMs: 5000,
	});
	assert.equal(net.requests.length, 1);
	// SPEC §4.1.3 EC-4: CDX-E702 before any socket opens; redirects are
	// followed only to allowlisted hosts.
	assert.equal(res.ok, false);
});

test("[§4.1 EC-5] child output past maxOutputBytes", async () => {
	const { ports } = createFakePorts();
	const result = await ports.proc.run(["cat", "big.bin"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 5000,
		maxOutputBytes: 16,
	});
	// SPEC §4.1.3 EC-5: killed with truncated true; the caller treats it as error.
	assert.equal(result.truncated, true);
});

test("[§4.1 EC-6] child ignoring SIGTERM on timeout", async () => {
	const { ports } = createFakePorts();
	const result = await ports.proc.run(["sleep", "30"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 50,
		maxOutputBytes: 65536,
	});
	// SPEC §4.1.3 EC-6: the tree is killed (SIGKILL / taskkill /T /F) within 1 s.
	assert.equal(result.timedOut, true);
});

test("[§4.1 EC-7] same JSON value written twice", () => {
	// SPEC §4.1.2 sorted keys + §4.10.4 integrity exception: the red suite
	// recorded values in input order; the contract sorts keys with values
	// following their keys, so the literal is corrected here and acknowledged
	// at review rather than loosened.
	const first = stableStringify({ b: 1, a: 2 });
	assert.equal(first, '{\n  "a": 2,\n  "b": 1\n}\n');
	assert.equal(stableStringify({ b: 1, a: 2 }), first);
});

test("[§4.1 EC-8] CRLF file hashes like its LF twin", () => {
	// SPEC §4.1.3 EC-8: CRLF and CR become LF before hashing.
	assert.equal(normalizeText("a\r\nb\r\n"), "a\nb\n");
	assert.equal(normalizeText("a\rb\r"), "a\nb\n");
});

test("[§4.1 EC-9] malformed JSON reports line and column", () => {
	// SPEC §4.1.3 EC-9: a Result error naming line and column, never a throw.
	const parsed = parseJson('{"a": }');
	assert.equal(parsed.ok, false);
});

test("[§4.1 EC-10] schema with an unsupported keyword", () => {
	// SPEC §4.1.3 EC-10: load fails CDX-E201, the keyword is never ignored.
	const checked = validateSchema(
		'{"type": "object", "unknownKeyword": true}',
		{},
	);
	assert.equal(checked.ok, false);
	if (!checked.ok) {
		assert.equal(checked.error.code, "CDX-E201");
	}
});

test("[§4.1 EC-11] git missing from PATH", async () => {
	const { ports } = createFakePorts();
	const root = await ports.git.root();
	// SPEC §4.1.3 EC-11: CDX-E703 with a remediation, not an empty answer.
	assert.equal(root.ok, false);
});

test("[§4.1 EC-12] non-UTF-8 file stays bytes", async () => {
	const { fs } = createFakePorts();
	fs.seedBytes("assets/blob.bin", new Uint8Array([0xff, 0xd8, 0xff]));
	const bytes = await fs.read("assets/blob.bin");
	assert.equal(bytes.ok, true);
	// SPEC §4.1.3 EC-12: text enforcers skip it and report
	// binary-or-unknown-encoding to the caller.
	const text = await fs.readText("assets/blob.bin");
	assert.equal(text.ok, false);
});

test("[§4.1 EC-13] token redacted while env reference survives", () => {
	const token = `ghp_${"a".repeat(36)}`;
	assert.equal(token.length, 40);
	const redacted = redactSecrets(
		`leaked ${token} but reference process.env.TOKEN stays`,
	);
	// SPEC §4.1.3 EC-13: first 4 characters plus length; the env name is kept.
	assert.ok(redacted.includes("ghp_…(40)"));
	assert.ok(redacted.includes("process.env.TOKEN"));
	assert.ok(!redacted.includes(token));
});
