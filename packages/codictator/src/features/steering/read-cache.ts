// SPEC §4.6.5: the per-session read cache. A read of the same range of an
// unchanged file is blocked as already-in-context; a changed file refreshes
// the entry. State is caller-owned (CONVENTIONS: no module-level mutable
// state); the hook runtime threads one cache per session id.
export interface ReadRange {
	readonly offset: number;
	readonly limit: number;
}

export interface ReadEntry {
	readonly hash: string;
	readonly wholeFile: boolean;
	readonly ranges: ReadonlyArray<ReadRange>;
}

export function createReadCache(): Map<string, ReadEntry> {
	return new Map<string, ReadEntry>();
}

function containsRange(
	recorded: ReadonlyArray<ReadRange>,
	requested: ReadRange,
): boolean {
	for (const entry of recorded) {
		if (
			requested.offset >= entry.offset &&
			requested.offset + requested.limit <= entry.offset + entry.limit
		) {
			return true;
		}
	}
	return false;
}

// SPEC §4.6.7 EC-9: a read of a modified file is allowed and the caller
// refreshes the cache by recording the new hash afterwards.
export function isRepeatRead(
	cache: ReadonlyMap<string, ReadEntry>,
	path: string,
	hash: string,
	range?: ReadRange,
): boolean {
	const entry = cache.get(path);
	if (entry === undefined || entry.hash !== hash) {
		return false;
	}
	if (range === undefined) {
		return true;
	}
	if (entry.wholeFile) {
		return true;
	}
	return containsRange(entry.ranges, range);
}

export function recordRead(
	cache: Map<string, ReadEntry>,
	path: string,
	hash: string,
	range?: ReadRange,
): void {
	const previous = cache.get(path);
	if (previous !== undefined && previous.hash === hash) {
		if (range === undefined || previous.wholeFile) {
			cache.set(path, { hash, wholeFile: true, ranges: [] });
			return;
		}
		cache.set(path, {
			hash,
			wholeFile: false,
			ranges: [...previous.ranges, range],
		});
		return;
	}
	if (range === undefined) {
		cache.set(path, { hash, wholeFile: true, ranges: [] });
		return;
	}
	cache.set(path, { hash, wholeFile: false, ranges: [range] });
}

// SPEC §4.6.5: the cache is cleared on compact.post and any new session.
export function clearReadCache(cache: Map<string, ReadEntry>): void {
	cache.clear();
}
