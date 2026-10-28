// SPEC §5.1: fixture-shaped evaluators for the steering-owned F1 rules.
// Each reads the self-test marker report (§4.4.1 sample.txt files) and
// answers whether the rule fires, so the pack self-test (§4.4.4) can drive
// them while the registry wiring lands in a later step.
export function parseMarkerMap(text: string): Map<string, string> {
	const markers = new Map<string, string>();
	for (const line of text.split("\n")) {
		const colon = line.indexOf(":");
		if (colon < 0) {
			continue;
		}
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (key.length > 0) {
			markers.set(key, value);
		}
	}
	return markers;
}

export function parseMarkerPercent(
	markers: ReadonlyMap<string, string>,
	key: string,
): number | undefined {
	const raw = markers.get(key) ?? "";
	const match = raw.match(/(\d+(?:\.\d+)?)\s*%/);
	if (match === null) {
		return undefined;
	}
	const parsed = Number.parseFloat(match[1] ?? "");
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseMarkerCount(
	markers: ReadonlyMap<string, string>,
	key: string,
): number | undefined {
	const raw = markers.get(key) ?? "";
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) ? parsed : undefined;
}

function checkpointDone(markers: ReadonlyMap<string, string>): boolean {
	return (markers.get("checkpoint") ?? "none") !== "none";
}

// SPEC §5.1 core/context-soft-band: usage at or past softPercent with no
// checkpoint summary advises; below the band, or already checkpointed,
// stays quiet.
export function evaluateContextSoftBand(
	markers: ReadonlyMap<string, string>,
	softPercent = 60,
): boolean {
	const percent = parseMarkerPercent(markers, "context-used");
	return (
		percent !== undefined && percent >= softPercent && !checkpointDone(markers)
	);
}

// SPEC §5.1 core/context-hard-band: usage at or past hardPercent with no
// forced checkpoint flags checkpointRequired.
export function evaluateContextHardBand(
	markers: ReadonlyMap<string, string>,
	hardPercent = 75,
): boolean {
	const percent = parseMarkerPercent(markers, "context-used");
	return (
		percent !== undefined && percent >= hardPercent && !checkpointDone(markers)
	);
}

// SPEC §5.1 core/session-tool-call-limit: calls past maxToolCalls flag.
export function evaluateToolCallLimit(
	markers: ReadonlyMap<string, string>,
	maxToolCalls = 300,
): boolean {
	const calls = parseMarkerCount(markers, "tool-calls");
	const limit = parseMarkerCount(markers, "limit") ?? maxToolCalls;
	return calls !== undefined && calls > limit;
}

// SPEC §4.6.7 EC-10: the same file twice flags only for an exact repeat;
// a first read, or reads of different files, stay quiet.
export function evaluateRepeatReads(reads: ReadonlyArray<string>): boolean {
	const seen = new Set<string>();
	for (const path of reads) {
		if (seen.has(path)) {
			return true;
		}
		seen.add(path);
	}
	return false;
}
