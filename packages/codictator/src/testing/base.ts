// SPEC §10.7 Adding rule: CI fails when a test that ran at the base commit
// becomes listed. Set computation is pure; reading the base commit is the CI
// workflow's job in step 1.8.
export function findNewlyListed(
	baseRed: readonly string[],
	headRed: readonly string[],
	baseTestIds: readonly string[],
): Array<string> {
	const listedBefore = new Set(baseRed);
	const ranBefore = new Set(baseTestIds);
	return headRed.filter(
		(entry) => !listedBefore.has(entry) && ranBefore.has(entry),
	);
}
