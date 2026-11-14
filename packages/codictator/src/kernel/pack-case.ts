// SPEC §4.4.1 pack case data: a file under
// <pack>/fixtures/<rule-slug>/(violating|passing)/<case>/ where <pack> holds
// a pack.json. It is rule test data judged only by pack self-test (§4.4.4),
// so verify, the server scope and the L3 hooks drop it by this one predicate.
// config.security.fixtureGlobs never reaches here: it relaxes secrets only.
import type { Fs } from "./index.ts";

const PACK_CASE_SHAPE =
	/^(?:(.+)\/)?fixtures\/[^/]+\/(?:violating|passing)\/[^/]+\/.+$/;

export async function isPackCasePath(path: string, fs: Fs): Promise<boolean> {
	const slashed = path.replaceAll("\\", "/");
	const matched = PACK_CASE_SHAPE.exec(slashed);
	if (matched === null) {
		return false;
	}
	const pack = matched[1];
	const manifest = pack === undefined ? "pack.json" : `${pack}/pack.json`;
	const found = await fs.exists(manifest);
	return found.ok && found.value;
}

export async function withoutPackCases(
	files: ReadonlyArray<string>,
	fs: Fs,
): Promise<Array<string>> {
	const kept: Array<string> = [];
	for (const file of files) {
		if (!(await isPackCasePath(file, fs))) {
			kept.push(file);
		}
	}
	return kept;
}
