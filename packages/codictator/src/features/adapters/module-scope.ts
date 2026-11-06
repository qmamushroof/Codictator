// SPEC §4.20.2 L2 on save + §4.20.4 EC-8: the module-membership predicate
// the save path judges. A file outside every configured module surfaces a
// `core/arch-module-mapped` diagnostic from `verify --layer L2`; the
// evaluation itself is owned by packs/cli, this predicate is the
// adapter-side seam that names which files are outside. Matching is
// slash-bounded, so `notes/todo.txt` never hides inside `src/**`.
function normalizeEntry(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

// A file is inside the map when it equals a module path or sits under a
// `base/**` entry; a bare `**` entry covers the whole repo.
export function isWithinModules(
	file: string,
	modules: ReadonlyArray<string>,
): boolean {
	const candidate = normalizeEntry(file);
	for (const pattern of modules) {
		const normalized = normalizeEntry(pattern);
		if (normalized === "**") {
			return true;
		}
		if (normalized.endsWith("/**")) {
			const base = normalized.slice(0, -"/**".length);
			if (
				base === "" ||
				candidate === base ||
				candidate.startsWith(`${base}/`)
			) {
				return true;
			}
			continue;
		}
		if (candidate === normalized) {
			return true;
		}
	}
	return false;
}

// A file outside every module flags `core/arch-module-mapped` on save.
export function isOutsideEveryModule(
	file: string,
	modules: ReadonlyArray<string>,
): boolean {
	return !isWithinModules(file, modules);
}
