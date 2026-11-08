import { strict as assert } from "node:assert";
import test from "node:test";
import { sharedReads } from "../../../src/cli/evaluate-cache.ts";
import {
	staticBlock,
	supportedHarness,
} from "../../../src/features/adapters/hook-static.ts";
import {
	activeWaivers as engineActiveWaivers,
	MAX_WAIVER_DAYS as engineMaxDays,
	readWaiverFile as engineReadWaiverFile,
	DEFAULT_WAIVER_STORE as engineStore,
} from "../../../src/features/engine/index.ts";
import {
	activeOn,
	chainValid,
	todayOf,
} from "../../../src/features/engine/waiver-chain.ts";
import { readWaiverFile as readWaiverFileDirect } from "../../../src/features/engine/waiver-file.ts";
import {
	activeWaivers,
	applyWaivers,
	DEFAULT_WAIVER_STORE,
	isWaived,
	MAX_WAIVER_DAYS,
	matchWaivers,
	readWaiverFile,
} from "../../../src/features/engine/waivers.ts";

test("[§4.11] waiver split modules keep their public import shape", () => {
	// SPEC §4.10.3 + §4.11 EC-6/EC-10: the waiver split keeps chain/file
	// helpers in their own modules and re-exports them through the
	// engine entry, so the public import shape is pinned here.
	assert.equal(typeof todayOf, "function");
	assert.equal(typeof activeOn, "function");
	assert.equal(typeof chainValid, "function");
	assert.equal(typeof readWaiverFileDirect, "function");
	assert.equal(typeof sharedReads, "function");
	assert.equal(typeof supportedHarness, "function");
	assert.equal(typeof staticBlock, "function");
	assert.equal(typeof applyWaivers, "function");
	assert.equal(typeof isWaived, "function");
	assert.equal(typeof matchWaivers, "function");
	assert.equal(readWaiverFile, readWaiverFileDirect);
	assert.equal(engineReadWaiverFile, readWaiverFileDirect);
	assert.equal(engineActiveWaivers, activeWaivers);
	assert.equal(engineStore, DEFAULT_WAIVER_STORE);
	assert.equal(engineMaxDays, MAX_WAIVER_DAYS);
});
