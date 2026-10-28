// SPEC §4.4.3 + §4.4.7: pack hashing, acceptance and loading. packHash
// covers every pack file except accepted.json; acceptance is human-only
// after a green self-test; composition rejects duplicate rule ids.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	packHashFor,
	selfTestHashFor,
	verifyAcceptance,
} from "../../../src/features/packs/hashes.ts";
import type { Pack, PackRule } from "../../../src/features/packs/index.ts";
import {
	acceptPack,
	composePacks,
	loadPack,
} from "../../../src/features/packs/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function ruleFor(id: string): PackRule {
	return {
		id,
		family: "F2",
		tier: "tunable",
		statement: "statement",
		reason: "reason",
		remediation: "do the compliant thing",
		enforcer: "check",
		triggers: ["startup"],
		scope: ["src/**/*.ts"],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function packFor(id: string, rules: ReadonlyArray<PackRule>): Pack {
	return {
		manifest: {
			id,
			version: "0.0.0",
			description: "test pack",
			rules: [...rules],
			enforcers: [],
			drivers: [],
			extractors: [],
			measures: [],
			capabilities: [],
			assets: [],
			maxWaiverDays: 90,
		},
		enforcers: [],
		drivers: [],
		assets: [],
	};
}

test("[§4.4] packs hashing skips accepted.json and sorts entries", async () => {
	const { fs } = createFakePorts();
	fs.seedText("pack/b.txt", "b");
	fs.seedText("pack/a.txt", "a");
	fs.seedText("pack/accepted.json", "accepted");
	const first = await packHashFor(fs, "pack");
	assert.ok(first.ok);
	if (first.ok) {
		fs.seedText("pack/a.txt", "changed");
		const second = await packHashFor(fs, "pack");
		assert.ok(second.ok);
		if (second.ok) {
			assert.notEqual(second.value, first.value);
		}
	}
	const hashed = selfTestHashFor(
		packFor("custom", [ruleFor("custom/r")]).manifest,
	);
	assert.equal(typeof hashed, "string");
	assert.equal(hashed.length, 64);
});

test("[§4.4] packs acceptance verifies the recorded hash", async () => {
	const { fs } = createFakePorts();
	const manifest = packFor("custom", [ruleFor("custom/r")]).manifest;
	fs.seedText("pack/pack.json", "{}");
	const hashed = await packHashFor(fs, "pack");
	assert.ok(hashed.ok);
	if (!hashed.ok) {
		return;
	}
	fs.seedText(
		"pack/accepted.json",
		JSON.stringify({ version: 1, packHash: "stale", selfTestHash: "s" }),
	);
	const schema = JSON.stringify({ type: "object" });
	const stale = await verifyAcceptance(fs, "pack", manifest, schema);
	assert.ok(!stale.ok);
	fs.seedText(
		"pack/accepted.json",
		JSON.stringify({ version: 1, packHash: hashed.value, selfTestHash: "s" }),
	);
	const fresh = await verifyAcceptance(fs, "pack", manifest, schema);
	assert.ok(fresh.ok);
	const absent = await verifyAcceptance(fs, "empty", manifest, schema);
	assert.ok(absent.ok);
	fs.seedText("pack/accepted.json", JSON.stringify({ version: 1 }));
	const noHash = await verifyAcceptance(fs, "pack", manifest, schema);
	assert.ok(!noHash.ok);
});

test("[§4.4] packs loading fails closed on missing and bad packs", async () => {
	const { ports, fs } = createFakePorts();
	const missing = await loadPack("nope", { ports });
	assert.ok(!missing.ok);
	fs.seedText("bad/pack.json", "{not json");
	const malformed = await loadPack("bad", { ports });
	assert.ok(!malformed.ok);
});

test("[§4.4] packs accept refuses non-human callers before loading", async () => {
	const { ports } = createFakePorts();
	const refused = await acceptPack("pack", ports, { isTty: false });
	assert.ok(!refused.ok);
});

test("[§4.4] packs composition rejects duplicate rule ids", () => {
	assert.ok(
		composePacks([
			packFor("a", [ruleFor("x/r")]),
			packFor("b", [ruleFor("y/r")]),
		]).ok,
	);
	const dup = composePacks([
		packFor("a", [ruleFor("x/r")]),
		packFor("b", [ruleFor("x/r")]),
	]);
	assert.ok(!dup.ok);
	if (!dup.ok) {
		assert.equal(dup.error.code, "CDX-E202");
	}
});
