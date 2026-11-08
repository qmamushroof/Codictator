// SPEC §4.6.2: the managed block carries every loaded floor rule and the
// per-phase gate commands inside 6,000 bytes, on the maximal pack set.
import { strict as assert } from "node:assert";
import test from "node:test";
import { guardrailPlan } from "../../../src/cli/plan.ts";
import { loadBuiltinPack } from "../../../src/features/packs/index.ts";
import {
	buildManagedBlock,
	floorRulesFromManifests,
	utf8Bytes,
} from "../../../src/features/steering/index.ts";

async function maximalFloorRules(): Promise<
	ReadonlyArray<{ readonly id: string; readonly statement: string }>
> {
	const collected = [];
	for (const id of ["core", "typescript", "python"]) {
		const loaded = await loadBuiltinPack(id);
		assert.equal(loaded.ok, true);
		if (!loaded.ok) {
			throw new Error(`pack ${id} failed to load`);
		}
		collected.push(loaded.value.manifest);
	}
	return floorRulesFromManifests(collected);
}

test("[§4.6.2] managed block names the gate command for every phase", () => {
	// SPEC §4.6.2 item 2: the workflow line carries the command for each
	// gate, so the agent never has to guess how to move on.
	const block = buildManagedBlock();
	for (const command of [
		"codictator task new",
		"codictator test red",
		"codictator test green",
		"codictator verify --staged",
		"codictator review submit",
		"codictator task phase next",
	]) {
		assert.ok(block.includes(command), `missing gate command ${command}`);
	}
});

test("[§4.6.2] maximal pack set block lists every floor rule within 6,000 bytes", async () => {
	// SPEC §4.6.2: the block is at most 6,000 bytes on the maximal pack
	// set, and every loaded tier:floor rule reaches the agent (G4).
	const floorRules = await maximalFloorRules();
	assert.ok(floorRules.length > 8);
	const block = buildManagedBlock({ floorRules });
	assert.ok(utf8Bytes(block) <= 6000, `block is ${utf8Bytes(block)} bytes`);
	for (const rule of floorRules) {
		assert.ok(block.includes(`${rule.id} — `), `missing floor rule ${rule.id}`);
	}
});

test("[§4.6.2] plan threads caller floor rules into the managed block", () => {
	// Callers (init, regen, context) pass floorRules built from the loaded
	// pack registry; the plan renders them instead of the default eight.
	const custom = [{ id: "custom/floor", statement: "A custom floor rule." }];
	const plan = guardrailPlan([], "", "repo", undefined, {
		floorRules: custom,
	});
	const agents = plan.files.find((entry) => entry.path === "AGENTS.md");
	assert.ok(agents !== undefined);
	assert.ok(agents.content.includes("custom/floor — A custom floor rule."));
});
