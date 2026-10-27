// SPEC §10.7 via VALIDATION: `npm run ledger -- --covers "<ref>"` lists ledger
// entries citing a SPEC reference, a single EC, or an EC range.
export interface CoverFilter {
	readonly section: string;
	readonly firstEc: number | undefined;
	readonly lastEc: number | undefined;
}

export function parseCoverSpecifier(spec: string): CoverFilter | undefined {
	const match = /^§(\d+(?:\.\d+)*)(?: EC-(\d+)(?:\.\.(\d+))?)?$/.exec(
		spec.trim(),
	);
	if (match === null) {
		return undefined;
	}
	const section = match[1];
	if (section === undefined) {
		return undefined;
	}
	const firstText = match[2];
	if (firstText === undefined) {
		return { section, firstEc: undefined, lastEc: undefined };
	}
	const first = Number.parseInt(firstText, 10);
	const lastText = match[3];
	const last = lastText === undefined ? first : Number.parseInt(lastText, 10);
	if (Number.isNaN(first) || Number.isNaN(last) || first > last) {
		return undefined;
	}
	return { section, firstEc: first, lastEc: last };
}

function citesEc(title: string, ec: number): boolean {
	return new RegExp(`(?:^|\\D)EC-${ec}(?:\\D|$)`).exec(title) !== null;
}

function titleOf(testId: string): string {
	const separator = testId.indexOf("::");
	return separator < 0 ? testId : testId.slice(separator + 2);
}

export function entryMatchesCover(
	testId: string,
	filter: CoverFilter,
): boolean {
	const title = titleOf(testId);
	if (!title.includes(`§${filter.section}`)) {
		return false;
	}
	if (filter.firstEc === undefined || filter.lastEc === undefined) {
		return true;
	}
	for (let ec = filter.firstEc; ec <= filter.lastEc; ec += 1) {
		if (citesEc(title, ec)) {
			return true;
		}
	}
	return false;
}

export function filterRedByCovers(
	red: readonly string[],
	filters: readonly CoverFilter[],
): Array<string> {
	if (filters.length === 0) {
		return [...red];
	}
	return red.filter((entry) =>
		filters.some((filter) => entryMatchesCover(entry, filter)),
	);
}
