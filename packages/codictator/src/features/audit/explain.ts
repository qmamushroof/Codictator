// SPEC §8.1: lookup over the error-code table (explain/nearest). The rows
// live in explain-table.ts and explain-table-tail.ts; this module combines
// them in SPEC §8.1 order and answers errorRowFor, explainCodeText and the
// CDX-E010 unknown-id text with the nearest known ids.
import { ERROR_ROWS_HEAD, type ErrorRow } from "./explain-table.ts";
import { ERROR_ROWS_TAIL } from "./explain-table-tail.ts";

// SPEC §8.1: all 58 explain targets in SPEC §8.1 order.
export const ERROR_ROWS: ReadonlyArray<ErrorRow> = [
	...ERROR_ROWS_HEAD,
	...ERROR_ROWS_TAIL,
];

// SPEC §4.18.2: `codictator explain CDX-Ennn` prints the §8 row.
export function errorRowFor(code: string): ErrorRow | undefined {
	for (const candidate of ERROR_ROWS) {
		if (candidate.code === code) {
			return candidate;
		}
	}
	return undefined;
}

// SPEC §4.18.2: whether explain() answers an id with a §8 row (as opposed
// to the CDX-E010 unknown-id path the CLI maps to exit 2).
export function isKnownExplainId(id: string): boolean {
	return errorRowFor(id) !== undefined;
}

// SPEC §4.18.2: the §8 row as human text; the code leads so the row is
// greppable, and the exit tells the caller which §8.2 bucket it lands in.
export function explainCodeText(rowValue: ErrorRow): string {
	return [
		`${rowValue.code}: ${rowValue.meaning} (exit ${rowValue.exit})`,
		`Do instead: ${rowValue.remediation}`,
		`See: SPEC §8.1 row ${rowValue.code}; codictator explain ${rowValue.code} prints this row.`,
	].join("\n");
}

function tokensOf(value: string): Array<string> {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 2);
}

// SPEC §4.18.6 EC-4: the nearest known ids for an unknown id. Scores each
// §8 row by word overlap with the query so a replay-flavoured id surfaces
// CDX-E011; ties break by code so the ranking is deterministic.
export function nearestExplainIds(id: string, limit = 3): Array<string> {
	const wanted = new Set(tokensOf(id));
	const scored: Array<{ code: string; score: number }> = [];
	for (const candidate of ERROR_ROWS) {
		if (candidate.code === "CDX-E010") {
			continue;
		}
		const haystack = new Set(
			tokensOf(
				`${candidate.code} ${candidate.meaning} ${candidate.remediation}`,
			),
		);
		let score = 0;
		for (const token of wanted) {
			if (haystack.has(token)) {
				score += 1;
			}
		}
		scored.push({ code: candidate.code, score });
	}
	scored.sort((left, right) =>
		right.score !== left.score
			? right.score - left.score
			: left.code < right.code
				? -1
				: 1,
	);
	return scored.slice(0, limit).map((entry) => entry.code);
}

// SPEC §4.18.6 EC-4 (and EC-5 when the query names a replay): CDX-E010
// with the nearest known ids, each with its one-line row.
export function explainUnknownText(id: string): string {
	const nearest = nearestExplainIds(id);
	const lines = [
		`CDX-E010: unknown rule, event or error id "${id}" (exit 2)`,
		"Do instead: check the spelling; rule ids look like pack/rule, error codes like CDX-Ennn, events need codictator replay <eventId>.",
		"Nearest known ids:",
	];
	for (const code of nearest) {
		const found = errorRowFor(code);
		if (found !== undefined) {
			lines.push(`- ${found.code}: ${found.meaning} (exit ${found.exit})`);
		}
	}
	const replay = errorRowFor("CDX-E011");
	if (nearest.includes("CDX-E011") && replay !== undefined) {
		lines.push(`Do instead for replays: ${replay.remediation}`);
	}
	return lines.join("\n");
}
