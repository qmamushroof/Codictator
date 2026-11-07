// SPEC §4.20.2 + EC-5: the PR4 Timeline polish — relative times, kind
// icons, filters, load-more paging, unseen-block badge and block toast.
// Red-first: the timeline.ts additions do not exist yet.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	arrayFieldOf,
	fieldOf,
	isRecord,
	stringFieldOf,
} from "../../src/engine-client.ts";
import type { TimelineEventRow } from "../../src/timeline.ts";
import {
	filterTimelineEvents,
	loadMoreItem,
	newBlockIds,
	newBlockToast,
	relativeTime,
	timelineRowLabel,
} from "../../src/timeline-rows.ts";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

function block(id: string, at: string): TimelineEventRow {
	return {
		at,
		id,
		kind: "verdict",
		layer: "L3",
		message: "blocked commit",
		source: "git",
		verdict: "block",
	};
}

test("[§4.20.2] timeline rows render relative times with a kind icon and block colour", () => {
	// SPEC §4.20.2 PR4: "2 m ago" plus `$(error)` for a block.
	const label = timelineRowLabel(block("e1", "2026-11-07T11:58:00.000Z"), NOW);
	assert.match(label, /\$\(error\)/);
	assert.match(label, /block/);
	assert.match(label, /2 m ago/);
	const allowed = timelineRowLabel(
		{
			at: "2026-11-07T11:59:30.000Z",
			id: "e2",
			kind: "verdict",
			source: "agent",
			verdict: "allow",
		},
		NOW,
	);
	assert.match(allowed, /\$\(check\)/);
	assert.match(allowed, /just now/);
});

test("[§4.20.2] relative times cover minutes, hours, days and unknown input", () => {
	// SPEC §4.20.2 PR4: the full relative scale plus the unknown fallback.
	assert.equal(relativeTime(NOW, undefined), "unknown time");
	assert.equal(relativeTime(NOW, "not-a-time"), "unknown time");
	assert.equal(relativeTime(NOW, "2026-11-07T11:59:50.000Z"), "just now");
	assert.equal(relativeTime(NOW, "2026-11-07T09:00:00.000Z"), "3 h ago");
	assert.equal(relativeTime(NOW, "2026-11-05T12:00:00.000Z"), "2 d ago");
});

test("[§4.20.4 EC-5] timeline filters by kind and source", () => {
	// SPEC §4.20.4 EC-5 PR4: the kind/source filter narrows the row list.
	const events: Array<TimelineEventRow> = [
		block("e1", "2026-11-07T11:58:00.000Z"),
		{ id: "e2", kind: "waiver", source: "agent" },
		{ id: "e3", kind: "verdict", source: "agent", verdict: "allow" },
	];
	assert.deepEqual(
		filterTimelineEvents(events, { kinds: ["verdict"] }).map((e) => e.id),
		["e1", "e3"],
	);
	assert.deepEqual(
		filterTimelineEvents(events, { sources: ["git"] }).map((e) => e.id),
		["e1"],
	);
	assert.deepEqual(
		filterTimelineEvents(events, {
			kinds: ["verdict"],
			sources: ["agent"],
		}).map((e) => e.id),
		["e3"],
	);
	assert.equal(filterTimelineEvents(events, {}).length, 3);
});

test("[§4.20.4 EC-5] timeline pages older events through a load more row", () => {
	// SPEC §4.20.4 EC-5 PR4: the "load more" row carries the `since` cursor.
	const item = loadMoreItem("cursor-9");
	assert.ok(isRecord(item));
	assert.match(String(stringFieldOf(item, "label") ?? ""), /Load more/);
	const command = fieldOf(item, "command");
	assert.ok(isRecord(command));
	assert.equal(
		stringFieldOf(command, "command"),
		"codictator.timelineLoadMore",
	);
	assert.deepEqual(arrayFieldOf(command, "args"), ["cursor-9"]);
});

test("[§4.20.2] unseen block count drives the badge and a non-modal toast", () => {
	// SPEC §4.20.2 PR4: blocks the user has not seen raise the badge and,
	// with notifyOnBlock on, one toast naming the count.
	const events: Array<TimelineEventRow> = [
		block("e1", "2026-11-07T11:58:00.000Z"),
		block("e2", "2026-11-07T11:59:00.000Z"),
		{ id: "e3", kind: "verdict", verdict: "allow" },
	];
	assert.deepEqual(newBlockIds(events, new Set()), ["e1", "e2"]);
	assert.deepEqual(newBlockIds(events, new Set(["e1", "e2"])), []);
	assert.equal(
		newBlockToast(events, new Set(), true),
		"Codictator blocked 2 events",
	);
	assert.equal(newBlockToast(events, new Set(["e1", "e2"]), true), undefined);
	assert.equal(newBlockToast(events, new Set(), false), undefined);
});
