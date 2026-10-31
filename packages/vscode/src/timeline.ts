// SPEC §4.20.2 + EC-5: the Timeline view over `events/tail` plus the
// `events/appended` subscription. The tree is virtualised: only the last
// 500 load and "load more" pages older events through the `since` cursor.
import type { EngineRequest } from "./engine-client.ts";
import {
	arrayFieldOf,
	engineRequestFor,
	isRecord,
	stringFieldOf,
} from "./engine-client.ts";

export interface TimelineEventRow {
	readonly id: string;
	readonly kind: string;
	readonly message?: string;
}

export interface TimelinePage {
	readonly events: ReadonlyArray<TimelineEventRow>;
	readonly cursor?: string;
}

export interface TimelineOptions {
	readonly since?: string;
	readonly limit?: number;
	readonly request?: EngineRequest;
}

// The stdio `events/appended` notification seam; production wires the
// server notification, tests pass a fake.
export interface TimelineDisposable {
	dispose(): void;
}

export interface TimelineSource {
	onEventsAppended(listener: (folderPath: string) => void): TimelineDisposable;
}

const TIMELINE_LIMIT_MAX = 500;

function toTimelineRow(entry: unknown): TimelineEventRow | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}
	const id = stringFieldOf(entry, "id");
	const kind = stringFieldOf(entry, "kind");
	if (id === undefined || id === "" || kind === undefined || kind === "") {
		return undefined;
	}
	const message = stringFieldOf(entry, "message");
	return message === undefined ? { id, kind } : { id, kind, message };
}

// Timeline over `events/tail`, newest first. The limit is clamped to 500
// (the server clamps at 1000); `since` pages older events and the returned
// cursor feeds the next page.
export async function listTimelineEvents(
	folderPath: string,
	options?: TimelineOptions,
): Promise<TimelinePage> {
	const wanted = options?.limit ?? 100;
	const limit = Math.min(Math.max(wanted, 1), TIMELINE_LIMIT_MAX);
	const params =
		options?.since === undefined ? { limit } : { since: options.since, limit };
	const answer = await engineRequestFor(options?.request)(
		folderPath,
		"events/tail",
		params,
	);
	const rows: Array<TimelineEventRow> = [];
	for (const entry of arrayFieldOf(answer, "events")) {
		const row = toTimelineRow(entry);
		if (row !== undefined) {
			rows.push(row);
		}
	}
	const events = [...rows].reverse();
	const newest = rows.length > 0 ? rows[rows.length - 1] : undefined;
	const cursor = newest?.id ?? options?.since;
	return cursor === undefined ? { events } : { events, cursor };
}

const noopSource: TimelineSource = {
	onEventsAppended: (
		_listener: (folderPath: string) => void,
	): TimelineDisposable => ({
		dispose: (): void => undefined,
	}),
};

let activeTimelineSource: TimelineSource = noopSource;

export function setTimelineSource(source: TimelineSource): void {
	activeTimelineSource = source;
}

export function resetTimelineSource(): void {
	activeTimelineSource = noopSource;
}

// The `events/appended` subscription: only the folder that changed
// re-reads its tail.
export function subscribeTimeline(
	folderPath: string,
	listener: (folderPath: string) => void,
	source?: TimelineSource,
): TimelineDisposable {
	const origin = source ?? activeTimelineSource;
	return origin.onEventsAppended((changed) => {
		if (changed === folderPath) {
			listener(folderPath);
		}
	});
}
