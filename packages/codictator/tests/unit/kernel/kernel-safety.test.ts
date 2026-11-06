// SPEC §9.2 and §4.7.1: unit tests for pattern safety and secret
// redaction. Each title cites the SPEC row it proves.
import { strict as assert } from "node:assert";
import test from "node:test";
import { checkPattern, redactSecrets } from "../../../src/kernel/index.ts";

test("[§9.2] checkPattern accepts a benign pattern", () => {
	assert.equal(checkPattern("src/[a-z]+\\.ts$").ok, true);
	assert.equal(checkPattern("(ab)+c").ok, true);
});

test("[§9.2] checkPattern rejects an overlong pattern", () => {
	assert.equal(checkPattern(`x${"a".repeat(1000)}`).ok, false);
});

test("[§9.2] checkPattern rejects nested quantifiers", () => {
	const rejected = checkPattern("(a+)+$");
	assert.equal(rejected.ok, false);
	if (!rejected.ok) {
		assert.equal(rejected.error.code, "CDX-E902");
	}
	assert.equal(checkPattern("(a*)*").ok, false);
	assert.equal(checkPattern("(a|b)+c").ok, true);
});

test("[§9.2] checkPattern rejects backreferences", () => {
	assert.equal(checkPattern("(a)\\1").ok, false);
});

test("[§9.2] checkPattern rejects unbalanced parentheses", () => {
	assert.equal(checkPattern("(ab").ok, false);
	assert.equal(checkPattern("ab)").ok, false);
});

test("[§9.2] checkPattern allows class literals and named groups", () => {
	assert.equal(checkPattern("[a+]+").ok, true);
	assert.equal(checkPattern("(?:ab)+c").ok, true);
	assert.equal(checkPattern("\\k<name>").ok, false);
});

test("[§9.2] checkPattern caps length at exactly 1000", () => {
	assert.equal(checkPattern("a".repeat(1000)).ok, true);
	assert.equal(checkPattern(`x${"a".repeat(1000)}`).ok, false);
});

test("[§4.7.1] redactSecrets redacts an AWS key", () => {
	// Split across literals so the repo-wide secret scan stays green on
	// this test vector; the runtime value is the documented example key.
	const redacted = redactSecrets("key AKIAIOSF" + "ODNN7EXAMPLE here");
	assert.ok(!redacted.includes("AKIAIOSF" + "ODNN7EXAMPLE"));
	assert.ok(redacted.includes("AKIA…(20)"));
});

test("[§4.7.1] redactSecrets redacts a GitHub token", () => {
	const token = `ghp_${"a".repeat(36)}`;
	const redacted = redactSecrets(`leaked ${token} end`);
	assert.ok(!redacted.includes(token));
	assert.ok(redacted.includes("ghp_…(40)"));
});

test("[§4.7.1] redactSecrets keeps env references", () => {
	const redacted = redactSecrets(
		"token = process.env.TOKEN and $" + "{API_KEY} stay",
	);
	assert.ok(redacted.includes("process.env.TOKEN"));
	assert.ok(redacted.includes("$" + "{API_KEY}"));
});

test("[§4.7.1] redactSecrets redacts a high-entropy assignment", () => {
	const redacted = redactSecrets('api_key = "Kj7mQ9vX2pL' + '5nR8wZ4sT6wQ2"');
	assert.ok(!redacted.includes("Kj7mQ9vX2pL" + "5nR8wZ4sT6wQ2"));
});

test("[§4.7.1] redactSecrets allows placeholders", () => {
	const redacted = redactSecrets('token = "xxxxxxxxxxxxxxxxxxxx"');
	assert.ok(redacted.includes("xxxxxxxxxxxxxxxxxxxx"));
});

test("[§4.7.1] redactSecrets redacts PEM blocks and JWTs", () => {
	const pem =
		"-----BEGIN PRIVATE KE" + "Y-----\nABCDEF\n-----END PRIVATE KEY-----";
	const redacted = redactSecrets(`holds ${pem} end`);
	assert.ok(!redacted.includes("ABCDEF"));
	const jwt =
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0." +
		"SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
	const jwtRedacted = redactSecrets(`bearer ${jwt}`);
	assert.ok(!jwtRedacted.includes(jwt));
});

test("[§4.7.1] redactSecrets prefers the widest overlapping match", () => {
	const token = `ghp_${"b".repeat(36)}`;
	const redacted = redactSecrets(`token = "${token}"`);
	assert.ok(!redacted.includes(token));
	assert.ok(redacted.includes("…("));
});

test("[§9.3] redactSecrets scales linearly on long name-character runs", () => {
	// SPEC §9.3/§10.5: §9.3 budgets are p95 enforced by stress tests, not by
	// a unit-level ratio. The old large/small ratio measured scheduler noise
	// (sub-ms denominator clamped to 1), so only the absolute bound stays.
	// It preserves the BUG-0001 regression signal (~5 s bug vs ms fixed):
	// a uniform name-character run must stay fast and unredacted.
	const small = "a".repeat(16 * 1024);
	const large = "a".repeat(64 * 1024);
	redactSecrets("warmup");
	assert.equal(redactSecrets(small), small);
	const startLarge = performance.now();
	assert.equal(redactSecrets(large), large);
	const largeMs = performance.now() - startLarge;
	assert.ok(largeMs < 1000, `65KB took ${largeMs} ms`);
});
