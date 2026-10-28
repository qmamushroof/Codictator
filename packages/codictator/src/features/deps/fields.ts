// SPEC §4.1.2: JSON narrowing for the npm driver and its clients. Bracket
// access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (packs/manifest narrows the
// same way).
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function field(
	record: Readonly<Record<string, unknown>>,
	name: string,
): unknown {
	return record[name];
}

export function stringField(
	record: Readonly<Record<string, unknown>>,
	name: string,
): string | undefined {
	const value = record[name];
	return typeof value === "string" ? value : undefined;
}

export function recordField(
	record: Readonly<Record<string, unknown>>,
	name: string,
): Record<string, unknown> | undefined {
	const value = record[name];
	return isJsonRecord(value) ? value : undefined;
}
