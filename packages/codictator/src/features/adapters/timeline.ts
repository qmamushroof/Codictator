// SPEC §4.20.2 + §4.20.4 EC-5: the timeline virtualization window. The
// event log appends oldest-first (§7.15 `events/tail`); the Timeline view
// renders newest-first but only loads the most recent page, fetching older
// pages through "load more". Both windows are pure slices over the stored
// order, so the view never holds 10,000 rows.
export const TIMELINE_PAGE_SIZE = 500;

export interface TimelineEventRef {
	readonly id: string;
}

function clampPageSize(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		return TIMELINE_PAGE_SIZE;
	}
	return limit;
}

// The initial window: the most recent `limit` events in stored order. A
// shorter log returns whole, so the first load never over-reads.
export function timelineTail<E extends TimelineEventRef>(
	events: ReadonlyArray<E>,
	limit: number = TIMELINE_PAGE_SIZE,
): Array<E> {
	const page = clampPageSize(limit);
	if (events.length <= page) {
		return [...events];
	}
	return events.slice(events.length - page);
}

// The "load more" window: the `limit` events immediately older than the
// oldest id already loaded. An unknown or first-page id loads nothing, so
// a stale cursor never duplicates or skips rows.
export function timelineOlder<E extends TimelineEventRef>(
	events: ReadonlyArray<E>,
	oldestLoadedId: string,
	limit: number = TIMELINE_PAGE_SIZE,
): Array<E> {
	const page = clampPageSize(limit);
	const at = events.findIndex((event) => event.id === oldestLoadedId);
	if (at <= 0) {
		return [];
	}
	return events.slice(Math.max(0, at - page), at);
}
