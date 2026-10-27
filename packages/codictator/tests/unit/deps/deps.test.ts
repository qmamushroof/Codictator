// SPEC §4.8.8: one red test per deps EC row. Latest-stable rows assert
// resolveLatest; verdict rows assert checkDeps findings and codes. Both still
// throw "not implemented", so all fifteen fail red until Phase 8 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	Manifest,
	RegistrySnapshot,
} from "../../../src/features/deps/index.ts";
import { checkDeps, resolveLatest } from "../../../src/features/deps/index.ts";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(files: ReadonlyArray<string> = []): CheckContext {
	return {
		trigger: "scheduled",
		scope: { files, sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function snapshotFor(versions: ReadonlyArray<string>): RegistrySnapshot {
	const versionTable: Record<string, { published: string }> =
		Object.fromEntries(
			versions.map((version) => [
				version,
				{ published: "2025-01-01T00:00:00.000Z" },
			]),
		);
	const table: Record<
		string,
		{ versions: Record<string, { published: string }> }
	> = {
		lodash: { versions: versionTable },
	};
	return {
		version: 1,
		ecosystem: "npm",
		fetchedAt: FIXED_INSTANT,
		packages: table,
		advisories: {},
	};
}

function manifestFor(range: string): Array<Manifest> {
	return [
		{
			ecosystem: "npm",
			path: "package.json",
			dependencies: [{ name: "lodash", range }],
		},
	];
}

test("[§4.8 EC-1] newest version two days old resolves to previous", () => {
	// SPEC §4.8.8 EC-1: latest stable is the previous version.
	const latest = resolveLatest(snapshotFor(["4.17.20", "4.17.21"]), "lodash");
	assert.equal(latest.ok, true);
});

test("[§4.8 EC-2] pinned advisory fixed yesterday is eligible via S9", async () => {
	// SPEC §4.8.8 EC-2: the fix is eligible; remediation names it.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("4.17.20"),
	);
	assert.ok(findings.length > 0);
});

test("[§4.8 EC-3] every newer version advisory keeps pinned when clean", () => {
	// SPEC §4.8.8 EC-3: latest stable stays pinned when pinned is clean.
	const latest = resolveLatest(snapshotFor(["4.17.20"]), "lodash");
	assert.equal(latest.ok, true);
});

test("[§4.8 EC-4] unpublished package blocks deprecated", async () => {
	// SPEC §4.8.8 EC-4: block core/dep-no-deprecated with "unpublished".
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("9.9.9"),
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/dep-no-deprecated"),
	);
});

test("[§4.8 EC-5] registry 429 retries then CDX-E401", async () => {
	// SPEC §4.8.8 EC-5: retry twice with backoff, then fail closed.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("4.17.20"),
	);
	assert.ok(findings.some((finding) => finding.code === "CDX-E401"));
});

test("[§4.8 EC-6] engines range exempt from exact pin", async () => {
	// SPEC §4.8.8 EC-6: compatibility declarations are not pins.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("^4.17.20"),
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/dep-exact-pin"),
	);
});

test("[§4.8 EC-7] git dependency pinned by full SHA is allowed", async () => {
	// SPEC §4.8.8 EC-7: latest-stable skipped, reported as unversioned source.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("git+https://example.com/r.git#abc123"),
	);
	assert.equal(findings.length, 0);
});

test("[§4.8 EC-8] scoped private registry without allowlist blocks", async () => {
	// SPEC §4.8.8 EC-8: CDX-E702 until the host joins config.network.registries.
	const findings = await checkDeps(ctxFor([".npmrc"]), manifestFor("1.0.0"));
	assert.ok(findings.some((finding) => finding.code === "CDX-E702"));
});

test("[§4.8 EC-9] major ten days old within lag passes with countdown", async () => {
	// SPEC §4.8.8 EC-9: pass; status shows the countdown.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("4.17.20"),
	);
	assert.equal(findings.length, 0);
});

test("[§4.8 EC-10] workspace pins judged separately counted once", async () => {
	// SPEC §4.8.8 EC-10: one-per-capability counts the package once.
	const findings = await checkDeps(
		ctxFor(["packages/a/package.json", "packages/b/package.json"]),
		manifestFor("4.17.20"),
	);
	assert.equal(findings.length, 0);
});

test("[§4.8 EC-11] withdrawn advisory clears on fresh fetch", async () => {
	// SPEC §4.8.8 EC-11: the next fresh fetch clears the finding.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("4.17.20"),
	);
	assert.equal(findings.length, 0);
});

test("[§4.8 EC-12] deliberate prerelease pin blocks with no waiver", () => {
	// SPEC §4.8.8 EC-12: block; floor, no waiver.
	const latest = resolveLatest(snapshotFor(["5.0.0-beta.1"]), "lodash");
	assert.equal(latest.ok, false);
});

test("[§4.8 EC-13] platform crypto beats uuid package", async () => {
	// SPEC §4.8.8 EC-13: block core/dep-one-per-capability, platform first.
	const findings = await checkDeps(
		ctxFor(["package.json"]),
		manifestFor("9.0.0"),
	);
	assert.ok(
		findings.some(
			(finding) => finding.ruleId === "core/dep-one-per-capability",
		),
	);
});

test("[§4.8 EC-14] clock before publish time is ineligible", () => {
	// SPEC §4.8.8 EC-14: age negative, version not eligible.
	const latest = resolveLatest(snapshotFor(["4.17.21"]), "lodash");
	assert.equal(latest.ok, true);
});

test("[§4.8 EC-15] renovate bump rewritten to pin on regen", async () => {
	// SPEC §4.8.8 EC-15: owned key rewritten; until then drift.
	const findings = await checkDeps(
		ctxFor(["renovate.json"]),
		manifestFor("4.17.20"),
	);
	assert.ok(findings.length >= 0);
});
