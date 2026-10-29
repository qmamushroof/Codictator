// SPEC §4.4.1: fixture measure-report markers. Sample files
// (`sample.txt`) carry `key: value` lines the marker enforcers honour;
// violating fixtures flag and passing fixtures stay clean. Split from the
// measures (health-measures) by responsibility: markers here, spans and
// counts there.
export function isMarkerFile(path: string): boolean {
	return path === "sample.txt" || path.endsWith("/sample.txt");
}

export function parseMarkers(text: string): Map<string, string> {
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

export function parseMarkerInt(
	markers: Map<string, string>,
	key: string,
): number | undefined {
	const raw = markers.get(key);
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) ? parsed : undefined;
}
