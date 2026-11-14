// SPEC §4.4.1 pack case data: a file under
// <pack>/fixtures/<rule-slug>/(violating|passing)/<case>/ where <pack> is the
// root of a pack Codictator loads (a built-in pack directory or a
// config.packs path), never a pack.json found on disk (BUG-0102). It is rule
// test data judged only by pack self-test (§4.4.4), so verify, the server
// scope and the L3 hooks drop it by this one predicate. config.security
// .fixtureGlobs never reaches here: it relaxes secrets only.

const PACK_CASE_SHAPE =
	/^(?:(.+)\/)?fixtures\/[^/]+\/(?:violating|passing)\/[^/]+\/.+$/;

// `roots` are repo-relative, `/`-separated pack roots; "" is the repo root.
// No roots (an unloadable config) exempts nothing, which fails closed.
export function isPackCasePath(
	path: string,
	roots: ReadonlyArray<string>,
): boolean {
	const matched = PACK_CASE_SHAPE.exec(path.replaceAll("\\", "/"));
	if (matched === null) {
		return false;
	}
	return roots.includes(matched[1] ?? "");
}

export function withoutPackCases(
	files: ReadonlyArray<string>,
	roots: ReadonlyArray<string>,
): Array<string> {
	return files.filter((file) => !isPackCasePath(file, roots));
}
