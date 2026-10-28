// SPEC §10.7: red-ledger file shape, entry ids, and read-side validation.
// IO (reading the file, JSON parsing) stays in the test-runner driver outside
// src/, because only the kernel may own parsing entry points (§10.3 item 6).
export interface LedgerFile {
	readonly version: 1;
	readonly red: readonly string[];
}

export function formatTestId(file: string, title: string): string {
	return `${file}::${title}`;
}

export interface SplitTestId {
	readonly file: string;
	readonly title: string;
}

export function splitTestId(testId: string): SplitTestId | undefined {
	const separator = testId.indexOf("::");
	if (separator < 1 || separator + 2 >= testId.length) {
		return undefined;
	}
	return {
		file: testId.slice(0, separator),
		title: testId.slice(separator + 2),
	};
}

function isLedgerShape(
	value: unknown,
): value is { version: unknown; red: unknown } {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is Array<string> {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function checkSortedUnique(red: Array<string>): void {
	for (let index = 1; index < red.length; index += 1) {
		const previous = red[index - 1];
		const current = red[index];
		if (
			previous === undefined ||
			current === undefined ||
			!(previous < current)
		) {
			throw new Error(
				`red ledger entries must be sorted with no duplicates; fix entry ${index}`,
			);
		}
	}
}

// The kernel will own Result<T> (§4.1); until it lands, invalid ledger content
// is a fail-closed throw caught by the driver, never a silent default-allow.
export function parseLedgerFile(value: unknown): LedgerFile {
	if (!isLedgerShape(value)) {
		throw new Error(
			"red ledger must be a JSON object with version 1 and a red list",
		);
	}
	if (value.version !== 1) {
		throw new Error("red ledger version must be 1");
	}
	const red = value.red;
	if (!isStringArray(red)) {
		throw new Error("red ledger red must be a list of test id strings");
	}
	for (const entry of red) {
		if (splitTestId(entry) === undefined) {
			throw new Error(
				"red ledger entry must look like <test file path>::<full test title>",
			);
		}
	}
	checkSortedUnique(red);
	return { version: 1, red };
}
