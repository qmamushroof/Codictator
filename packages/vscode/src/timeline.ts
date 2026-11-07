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
	// SPEC §4.20.2 PR4: the shaping the Timeline polish reads. `at` is the
	// event `ts` (falling back to `now`); `verdict` the block/allow
	// decision; `source` agent vs git; `layer` the originating layer.
	readonly at?: string;
	readonly verdict?: string;
	readonly source?: string;
	readonly layer?: string;
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

// The event `ts` (falling back to `now`); absent stays absent so the row
// reads "unknown time" instead of guessing.
function timelineAtOf(entry: Record<string, unknown>): string | undefined {
	return stringFieldOf(entry, "ts") ?? stringFieldOf(entry, "now");
}

// The block/allow decision; `decision` is the older engine spelling.
function timelineVerdictOf(entry: Record<string, unknown>): string | undefined {
	return stringFieldOf(entry, "verdict") ?? stringFieldOf(entry, "decision");
}

// Agent vs git. A git trigger prefix reads git; anything else is agent work.
function timelineSourceOf(entry: Record<string, unknown>): string | undefined {
	const source = stringFieldOf(entry, "source");
	if (source !== undefined) {
		return source;
	}
	const trigger = stringFieldOf(entry, "trigger");
	if (trigger === undefined) {
		return undefined;
	}
	return trigger.startsWith("git") ? "git" : "agent";
}

// The mutable draft behind a TimelineEventRow; optional fields stay unset
// until the engine reports them.
interface TimelineRowDraft {
	at?: string;
	id: string;
	kind: string;
	layer?: string;
	message?: string;
	source?: string;
	verdict?: string;
}

// The optional row fields — message, time, verdict, source, layer — each
// set only when the engine reported it.
function fillTimelineRow(
	row: TimelineRowDraft,
	entry: Record<string, unknown>,
): void {
	const message = stringFieldOf(entry, "message");
	if (message !== undefined) {
		row.message = message;
	}
	const at = timelineAtOf(entry);
	if (at !== undefined) {
		row.at = at;
	}
	const verdict = timelineVerdictOf(entry);
	if (verdict !== undefined) {
		row.verdict = verdict;
	}
	const source = timelineSourceOf(entry);
	if (source !== undefined) {
		row.source = source;
	}
	const layer = stringFieldOf(entry, "layer");
	if (layer !== undefined) {
		row.layer = layer;
	}
}

function toTimelineRow(entry: unknown): TimelineEventRow | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}
	const id = stringFieldOf(entry, "id");
	const kind = stringFieldOf(entry, "kind");
	if (id === undefined || id === "" || kind === undefined || kind === "") {
		return undefined;
	}
	const row: TimelineRowDraft = { id, kind };
	fillTimelineRow(row, entry);
	return row;
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
