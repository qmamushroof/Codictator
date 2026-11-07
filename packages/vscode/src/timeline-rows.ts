// SPEC §4.20.2 PR4: the Timeline rows — relative times, kind icons, filter,
// load-more paging, unseen-block ids and the block toast. Row shaping over
// the TimelineEventRow owned by timeline.ts; the list and subscription stay
// there.
import type { TimelineEventRow } from "./timeline.ts";

// SPEC §4.20.2 PR4: the Timeline polish. Relative times take the clock as
// an explicit millisecond value, so no wall-clock read hides in the view
// layer (CONVENTIONS.md determinism); icons render as codicons in the row
// label, which needs no API newer than 1.105 (EC-6).
export function relativeTime(nowMs: number, at?: string): string {
	if (at === undefined) {
		return "unknown time";
	}
	const then = Date.parse(at);
	if (Number.isNaN(then)) {
		return "unknown time";
	}
	const diffMs = nowMs - then;
	if (diffMs < 45_000) {
		return "just now";
	}
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 60) {
		return `${minutes} m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours} h ago`;
	}
	return `${Math.floor(hours / 24)} d ago`;
}

// SPEC §4.20.2 PR4: the icon per kind and verdict. Blocks read `$(error)`,
// allows `$(check)`; anything else falls back to its kind icon.
function timelineIcon(event: TimelineEventRow): string {
	if (event.verdict === "block") {
		return "$(error)";
	}
	if (event.verdict === "allow") {
		return "$(check)";
	}
	switch (event.kind) {
		case "waiver": {
			return "$(key)";
		}
		case "verdict": {
			return "$(comment)";
		}
		case "injection": {
			return "$(zap)";
		}
		case "escalation": {
			return "$(warning)";
		}
		default: {
			return "$(circle-outline)";
		}
	}
}

// SPEC §4.20.2 PR4: one timeline row — icon, verdict or kind, source and
// relative time, so a block scans without opening.
export function timelineRowLabel(
	event: TimelineEventRow,
	nowMs: number,
): string {
	const head = event.verdict ?? event.kind;
	const parts = [`${timelineIcon(event)} ${head}`];
	if (event.source !== undefined) {
		parts.push(event.source);
	} else if (event.layer !== undefined) {
		parts.push(event.layer);
	}
	parts.push(relativeTime(nowMs, event.at));
	return parts.join(" · ");
}

export interface TimelineFilter {
	readonly kinds?: ReadonlyArray<string>;
	readonly sources?: ReadonlyArray<string>;
}

// SPEC §4.20.4 EC-5 PR4: the Timeline filter — kinds, sources (agent vs
// git), or both. An absent list filters nothing.
export function filterTimelineEvents(
	events: ReadonlyArray<TimelineEventRow>,
	filter: TimelineFilter,
): Array<TimelineEventRow> {
	return events.filter(
		(event) =>
			(filter.kinds === undefined ||
				filter.kinds.length === 0 ||
				filter.kinds.includes(event.kind)) &&
			(filter.sources === undefined ||
				filter.sources.length === 0 ||
				(event.source !== undefined && filter.sources.includes(event.source))),
	);
}

// SPEC §4.20.4 EC-5 PR4: the "load more" row. It carries the `since` cursor
// so the next page of older events loads through `events/tail`.
export function loadMoreItem(cursor: string): unknown {
	return {
		command: {
			args: [cursor],
			command: "codictator.timelineLoadMore",
			title: "Load more timeline events",
		},
		label: "Load more…",
	};
}

// SPEC §4.20.2 PR4: the ids of blocked events the user has not seen, which
// feed the view-container badge and the block toast.
export function newBlockIds(
	events: ReadonlyArray<TimelineEventRow>,
	seenIds: ReadonlySet<string>,
): Array<string> {
	const unseen: Array<string> = [];
	for (const event of events) {
		if (event.verdict === "block" && !seenIds.has(event.id)) {
			unseen.push(event.id);
		}
	}
	return unseen;
}

// SPEC §4.20.2 PR4: the non-modal block toast. One line naming the unseen
// block count, or undefined when there is nothing new or toasts are off
// (`codictator.notifyOnBlock`).
export function newBlockToast(
	events: ReadonlyArray<TimelineEventRow>,
	seenIds: ReadonlySet<string>,
	notifyOn: boolean,
): string | undefined {
	if (!notifyOn) {
		return undefined;
	}
	const count = newBlockIds(events, seenIds).length;
	if (count === 0) {
		return undefined;
	}
	return count === 1
		? "Codictator blocked 1 event"
		: `Codictator blocked ${count} events`;
}
