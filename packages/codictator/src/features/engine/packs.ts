// SPEC §7.10: the verdict packs map pins the evaluated pack versions, so
// the Timeline row names what judged the call. One helper serves the CLI
// emit and the hook runtime; adapters never import cli (§3.3).
export interface PackEntry {
	readonly id: string;
	readonly version?: string;
}

export function packsRecord(
	packs: ReadonlyArray<PackEntry>,
	engineVersion: string,
): Record<string, string> {
	const record: Record<string, string> = {};
	for (const pack of packs) {
		record[pack.id] = pack.version ?? engineVersion;
	}
	return record;
}
