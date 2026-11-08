// SPEC §4.2.1 step 4 + §4.3.6: the effective rule parameters and the
// shared scope-read cache. Waivers loosen within bound only, the strictest
// overlap wins, and cached reads stay copies so guards never share bytes.
import { strict as assert } from "node:assert";
import test from "node:test";
import { sharedReads } from "../../../src/cli/evaluate-cache.ts";
import { applyWaiverParams } from "../../../src/cli/waiver-params.ts";
import type {
	Waiver,
	WaiverStore,
} from "../../../src/features/engine/index.ts";
import type {
	PackManifest,
	PackRule,
	PackRuleParam,
} from "../../../src/kernel/index.ts";
import { makeError } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";

function paramFor(over: Partial<PackRuleParam> = {}): PackRuleParam {
	return {
		type: "integer",
		default: 3,
		bound: 5,
		stricter: "lower",
		...over,
	};
}

function capRule(
	tier: string,
	params?: Record<string, PackRuleParam>,
): PackRule {
	return {
		id: "core/review-round-cap",
		family: "F9",
		tier,
		statement: "Reviews close within maxRounds rounds.",
		reason: "Unbounded review never lands.",
		remediation: "Land or escalate.",
		enforcer: "core/review-round-cap",
		triggers: ["review"],
		scope: [],
		params: params ?? { maxRounds: paramFor() },
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function miniManifest(params?: Record<string, PackRuleParam>): PackManifest {
	return {
		id: "core",
		version: "0.0.0",
		description: "mini manifest for the waiver overlay",
		rules: [capRule("tunable", params)],
		enforcers: [],
		drivers: [],
		extractors: [],
		measures: [],
		capabilities: [],
		assets: [],
		maxWaiverDays: 90,
	};
}

function waiverFor(
	params: Record<string, number>,
	over: Partial<Waiver> = {},
): Waiver {
	return {
		id: "W-0001",
		rule: "core/review-round-cap",
		params,
		reason: "fourth review round passed with zero blockers",
		created: "2026-01-01",
		expires: "2026-03-31",
		createdBy: "human",
		...over,
	};
}

function waivedStore(
	params: Record<string, number>,
	over: Partial<Waiver> = {},
): WaiverStore {
	return {
		waivers: [waiverFor(params, over)],
		tiers: { "core/review-round-cap": "tunable" },
		maxWaiverDays: 90,
	};
}

function loosenedDefault(manifest: PackManifest, store: WaiverStore): unknown {
	const out = applyWaiverParams(manifest, store, FIXED_INSTANT);
	return out.rules[0]?.params["maxRounds"]?.default;
}

test("[§4.2] non-tunable param types stay out of the overlay", () => {
	const manifest = miniManifest({
		maxRounds: paramFor({ type: "string[]", default: ["a"], bound: ["a"] }),
	});
	const out = applyWaiverParams(
		manifest,
		waivedStore({ maxRounds: 4 }),
		FIXED_INSTANT,
	);
	assert.equal(out, manifest);
});

test("[§4.2] non-finite waiver bounds stay inert", () => {
	const manifest = miniManifest({
		maxRounds: paramFor({ default: Number.NaN, bound: 5 }),
	});
	const out = applyWaiverParams(
		manifest,
		waivedStore({ maxRounds: 4 }),
		FIXED_INSTANT,
	);
	assert.equal(out, manifest);
});

test("[§4.2] out-of-window waiver values stay inert", () => {
	const manifest = miniManifest();
	assert.equal(loosenedDefault(manifest, waivedStore({ maxRounds: 99 })), 3);
	assert.equal(loosenedDefault(manifest, waivedStore({ maxRounds: -1 })), 3);
});

test("[§4.2] a waiver equal to the default changes nothing", () => {
	const manifest = miniManifest();
	const out = applyWaiverParams(
		manifest,
		waivedStore({ maxRounds: 3 }),
		FIXED_INSTANT,
	);
	assert.equal(out, manifest);
});

test("[§4.3] overlapping waivers resolve to the strictest value", () => {
	const store: WaiverStore = {
		waivers: [
			waiverFor({ maxRounds: 5 }, { id: "W-0001" }),
			waiverFor({ maxRounds: 4 }, { id: "W-0002" }),
		],
		tiers: { "core/review-round-cap": "tunable" },
		maxWaiverDays: 90,
	};
	assert.equal(loosenedDefault(miniManifest(), store), 4);
});

test("[§4.3] path-scoped waivers stay out of the overlay", () => {
	const manifest = miniManifest();
	const out = applyWaiverParams(
		manifest,
		waivedStore({ maxRounds: 4 }, { paths: ["src/**"] }),
		FIXED_INSTANT,
	);
	assert.equal(out, manifest);
});

test("[§4.3] expired waivers stay out of the overlay", () => {
	const manifest = miniManifest();
	const out = applyWaiverParams(
		manifest,
		waivedStore({ maxRounds: 4 }, { expires: "2025-01-01" }),
		FIXED_INSTANT,
	);
	assert.equal(out, manifest);
});

test("[§4.3] the overlay never mutates the input manifest", () => {
	const manifest = miniManifest();
	const before = manifest.rules[0]?.params["maxRounds"];
	const out = applyWaiverParams(
		manifest,
		waivedStore({ maxRounds: 4 }),
		FIXED_INSTANT,
	);
	assert.equal(loosenedDefault(out, waivedStore({ maxRounds: 4 })), 4);
	assert.equal(manifest.rules[0]?.params["maxRounds"], before);
	assert.equal(before?.default, 3);
});

class CountingFs extends FakeFs {
	reads = 0;

	override read(path: string): ReturnType<FakeFs["read"]> {
		this.reads += 1;
		return super.read(path);
	}
}

test("[§4.3] shared reads load once and hand out copies", async () => {
	const inner = new CountingFs();
	inner.seedText("a.txt", "one");
	const shared = sharedReads(inner);
	const first = await shared.read("a.txt");
	const second = await shared.read("a.txt");
	assert.equal(first.ok && second.ok, true);
	if (!first.ok || !second.ok) {
		return;
	}
	assert.deepEqual([...first.value], [...second.value]);
	first.value[0] = 88;
	const third = await shared.read("a.txt");
	assert.equal(third.ok, true);
	if (!third.ok) {
		return;
	}
	assert.equal(new TextDecoder().decode(third.value), "one");
	assert.equal(inner.reads, 1);
});

test("[§4.3] a cached read failure passes the error through", async () => {
	const inner = new FakeFs();
	const shared = sharedReads(inner);
	inner.failNext(makeError("CDX-E000", "boom", "retry"));
	const first = await shared.read("a.txt");
	assert.equal(first.ok, false);
	const second = await shared.read("a.txt");
	assert.equal(second.ok, false);
});

test("[§4.3] writes invalidate the cached text", async () => {
	const inner = new FakeFs();
	inner.seedText("a.txt", "one");
	const shared = sharedReads(inner);
	const before = await shared.readText("a.txt");
	assert.equal(before.ok && before.value, "one");
	const encoder = new TextEncoder();
	const saved = await shared.write("a.txt", encoder.encode("two"));
	assert.equal(saved.ok, true);
	const after = await shared.readText("a.txt");
	assert.equal(after.ok && after.value, "two");
});

test("[§4.3] a failed write keeps the cached text", async () => {
	const inner = new FakeFs();
	inner.seedText("a.txt", "one");
	const shared = sharedReads(inner);
	const before = await shared.readText("a.txt");
	assert.equal(before.ok && before.value, "one");
	inner.failNext(makeError("CDX-E000", "boom", "retry"));
	const saved = await shared.write("a.txt", new TextEncoder().encode("two"));
	assert.equal(saved.ok, false);
	const after = await shared.readText("a.txt");
	assert.equal(after.ok && after.value, "one");
});

test("[§4.3] shared realpaths cache the lookup", async () => {
	const inner = new FakeFs();
	inner.seedText("a.txt", "one");
	const shared = sharedReads(inner);
	const first = await shared.realpath("a.txt");
	const second = await shared.realpath("a.txt");
	assert.equal(first.ok && second.ok, true);
	if (!first.ok || !second.ok) {
		return;
	}
	assert.equal(first.value, second.value);
});
