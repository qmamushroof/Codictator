// SPEC §4.1.2: every expected failure carries a CdxError whose code exists
// in SPEC §8. The code tables are append-only, so constructors take the code
// as data and callers cite the SPEC row that owns it.
export interface CdxError {
	readonly code: string;
	readonly message: string;
	readonly detail?: string;
	readonly remediation: string;
}

export function makeError(
	code: string,
	message: string,
	remediation: string,
	detail?: string,
): CdxError {
	if (detail === undefined) {
		return { code, message, remediation };
	}
	return { code, message, detail, remediation };
}
