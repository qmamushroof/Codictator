// SPEC §4.3.4: a waiver without path narrowing applies repo-wide. The
// waive CLI writes paths: [] when no --paths flag is given, so an empty
// path list must match every path (BUG-0065: it matched nothing).
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	matchWaivers,
	type WaiverStore,
} from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

test("[§4.3.4] waiver with empty paths applies repo-wide", () => {
	const store: WaiverStore = {
		waivers: [
			{
				id: "W-0001",
				rule: "core/file-size",
				params: { maxLines: 400 },
				paths: [],
				reason: "generated file over the default limit for tests",
				created: "2026-01-01",
				expires: "2026-03-31",
				createdBy: "human",
			},
		],
		tiers: { "core/file-size": "tunable" },
		maxWaiverDays: 90,
	};
	const matched = matchWaivers(
		store,
		"core/file-size",
		"src/anywhere/deep.ts",
		FIXED_INSTANT,
	);
	assert.equal(matched.ok, true);
	if (!matched.ok) {
		return;
	}
	assert.deepEqual(
		matched.value.map((waiver) => waiver.id),
		["W-0001"],
	);
});
