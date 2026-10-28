// SPEC §4.4.7 + §4.3.4: custom-pack acceptance after a green self-test, and
// waiver matching with chains, renewals and bounds. Ports are faked; the
// self-test runs over an empty rule set, so acceptance is fully scripted.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Waiver } from "../../../src/features/engine/index.ts";
import { isWaived, matchWaivers } from "../../../src/features/engine/index.ts";
import { acceptPack } from "../../../src/features/packs/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const STORE = {
	waivers: [],
	tiers: { "core/file-size": "tunable" as const },
	maxWaiverDays: 90,
};

function waiverFor(over: Partial<Waiver>): Waiver {
	return {
		id: "W-1",
		rule: "core/file-size",
		params: {},
		reason: "a sufficiently long reason for the waiver",
		created: "2026-01-01",
		expires: "2026-02-01",
		createdBy: "human",
		...over,
	};
}

test("[§4.3] waivers match by rule scope and active window", async () => {
	const store = { ...STORE, waivers: [waiverFor({ paths: ["src/**"] })] };
	const matched = matchWaivers(
		store,
		"core/file-size",
		"src/a.ts",
		"2026-01-15T00:00:00Z",
	);
	assert.ok(matched.ok && matched.value.length === 1);
	const scoped = await isWaived(
		"core/file-size",
		"docs/a.md",
		"2026-01-15T00:00:00Z",
		store,
	);
	assert.ok(scoped.ok && scoped.value === false);
	const lapsed = await isWaived(
		"core/file-size",
		"src/a.ts",
		"2026-05-01T00:00:00Z",
		store,
	);
	assert.ok(lapsed.ok && lapsed.value === false);
	const wide = await isWaived(
		"core/file-size",
		"anywhere.md",
		"2026-01-15T00:00:00Z",
		{
			...STORE,
			waivers: [waiverFor({})],
		},
	);
	assert.ok(wide.ok && wide.value === true);
	const floor = matchWaivers(
		{ ...STORE, tiers: {}, waivers: [waiverFor({ rule: "core/no-bypass" })] },
		"core/no-bypass",
		"src/a.ts",
		"2026-01-15T00:00:00Z",
	);
	assert.ok(!floor.ok);
});

test("[§4.3] waivers honour one renewal within twice the window", async () => {
	const first = waiverFor({
		id: "W-1",
		created: "2026-01-01",
		expires: "2026-02-01",
	});
	const second = waiverFor({
		id: "W-2",
		created: "2026-02-01",
		expires: "2026-04-01",
		renews: "W-1",
	});
	const store = { ...STORE, waivers: [first, second] };
	const renewed = await isWaived(
		"core/file-size",
		"src/a.ts",
		"2026-03-01T00:00:00Z",
		store,
	);
	assert.ok(renewed.ok && renewed.value === true);
	const third = waiverFor({ id: "W-3", renews: "W-2", expires: "2026-05-01" });
	const chained = matchWaivers(
		{ ...STORE, waivers: [first, second, third] },
		"core/file-size",
		"src/a.ts",
		"2026-01-15T00:00:00Z",
	);
	assert.ok(chained.ok);
	if (chained.ok) {
		const ids = chained.value.map((waiver) => waiver.id);
		assert.deepEqual(ids, ["W-1"]);
	}
	const cyclic = await isWaived(
		"core/file-size",
		"src/a.ts",
		"2026-03-01T00:00:00Z",
		{
			...STORE,
			waivers: [waiverFor({ id: "W-1", renews: "W-1" })],
		},
	);
	assert.ok(cyclic.ok && cyclic.value === false);
	const dangling = await isWaived(
		"core/file-size",
		"src/a.ts",
		"2026-03-01T00:00:00Z",
		{
			...STORE,
			waivers: [waiverFor({ id: "W-9", renews: "W-missing" })],
		},
	);
	assert.ok(dangling.ok && dangling.value === false);
	const backwards = await isWaived(
		"core/file-size",
		"src/a.ts",
		"2026-01-15T00:00:00Z",
		{
			...STORE,
			waivers: [waiverFor({ created: "2026-02-01", expires: "2026-01-01" })],
		},
	);
	assert.ok(backwards.ok && backwards.value === false);
	const undated = await isWaived(
		"core/file-size",
		"src/a.ts",
		"2026-01-15T00:00:00Z",
		{
			...STORE,
			waivers: [waiverFor({ created: "someday", expires: "never" })],
		},
	);
	assert.ok(undated.ok && undated.value === false);
});

test("[§4.4] pack accept writes accepted.json after a green self-test", async () => {
	const { ports, fs, git } = createFakePorts();
	fs.seedText(
		"pack/pack.json",
		JSON.stringify({
			id: "custom",
			version: "0.0.0",
			description: "test pack",
			rules: [],
			enforcers: [],
			maxWaiverDays: 90,
		}),
	);
	git.setConfig("user.email", "human@example.com");
	const accepted = await acceptPack("pack", ports, { isTty: true });
	assert.ok(accepted.ok);
	if (accepted.ok) {
		assert.equal(accepted.value.acceptedBy, "human@example.com");
		assert.equal(accepted.value.version, 1);
	}
	const seen = await fs.exists("pack/accepted.json");
	assert.ok(seen.ok && seen.value === true);
});

test("[§4.4] pack accept refuses failing gates before writing", async () => {
	const { ports, fs } = createFakePorts();
	const missing = createFakePorts();
	const noPack = await acceptPack("pack", missing.ports, { isTty: true });
	assert.ok(!noPack.ok);
	fs.seedText(
		"pack/pack.json",
		JSON.stringify({
			id: "custom",
			version: "0.0.0",
			description: "t",
			rules: [],
			enforcers: [],
			maxWaiverDays: 90,
		}),
	);
	const noAuthor = await acceptPack("pack", ports, { isTty: true });
	assert.ok(!noAuthor.ok);
	const badPack = await acceptPack("missing", ports, { isTty: true });
	assert.ok(!badPack.ok);
});
