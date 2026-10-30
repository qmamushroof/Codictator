// SPEC §4.19: the built bin entry answers only when the executed path
// resolves to this module. Under an npm-workspace symlink (or npm link)
// argv[1] keeps the symlink spelling while the ESM loader resolves
// import.meta.url to the real path, so a plain string compare silently
// skips the CLI and exits 0. Comparing realpaths keeps linked installs
// working; a path that cannot resolve falls back to its spelling, so a
// missing entry still compares false instead of throwing.
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolved(value: string): string {
	try {
		return realpathSync(value);
	} catch {
		return path.resolve(value);
	}
}

export function isEntryModule(
	argvOne: string | undefined,
	metaUrl: string,
): boolean {
	if (argvOne === undefined || argvOne === "") {
		return false;
	}
	let entry: string;
	try {
		entry = fileURLToPath(metaUrl);
	} catch {
		return false;
	}
	return resolved(path.resolve(argvOne)) === resolved(entry);
}
