// SPEC §4.20.2 + BUG-0054: the extension refreshes only the views each
// trigger owns. An events-log change refreshes Timeline, Steering, Budget
// and Violations; a config/waivers change refreshes Rules and Health. The
// workspace watcher debounces at 300 ms and a ping runs every 30 s. Before
// the fix every trigger repopulated every view and no watcher or ping ran,
// so the views stayed stale until a manual action.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	CONFIG_VIEW_IDS,
	EVENT_VIEW_IDS,
	viewsForChangedPath,
} from "../../src/live-refresh.ts";

test("[§4.20.2] events-log changes refresh the event views only", () => {
	assert.deepEqual(
		[...viewsForChangedPath(".codictator/state/events.jsonl")].sort(),
		[...EVENT_VIEW_IDS].sort(),
	);
	assert.deepEqual(viewsForChangedPath(".codictator/state/events.jsonl"), [
		"codictator-timeline",
		"codictator-steering",
		"codictator-budget",
		"codictator-violations",
	]);
});

test("[§4.20.2] config and waiver changes refresh the config views only", () => {
	for (const changed of [
		".codictator/config.json",
		".codictator/waivers.json",
		".codictator/baseline.json",
		".codictator/plan/remediation.json",
	]) {
		assert.deepEqual(
			[...viewsForChangedPath(changed)].sort(),
			[...CONFIG_VIEW_IDS].sort(),
		);
	}
	assert.deepEqual(viewsForChangedPath(".codictator/config.json"), [
		"codictator-active-rules",
		"codictator-health",
	]);
});
