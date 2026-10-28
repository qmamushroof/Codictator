// SPEC §6.1 file naming: `kebab-case` for `.ts`, `.tsx`, `.js`, `.mjs`,
// `.cjs`; tests are `*.test.<ext>`; framework-reserved names (`[id].tsx`,
// `+page.svelte`, `_app.tsx`) stay allowed. Consumed by `core/file-naming`.
function baseName(path: string): string {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return slash < 0 ? path : path.slice(slash + 1);
}

function isKebabStem(stem: string): boolean {
	return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
}

// Test files carry `.test.` before the extension: `sample.test.ts`.
export function isTestFileName(path: string): boolean {
	const name = baseName(path).toLowerCase();
	return name.includes(".test.");
}

// Framework-reserved names escape kebab-case: bracket routes, `+` pages and
// `_` layouts are the framework's contract, not the author's choice.
export function isFrameworkReservedName(path: string): boolean {
	const name = baseName(path);
	return name.startsWith("[") || name.startsWith("+") || name.startsWith("_");
}

export function checkTypeScriptFileName(path: string): {
	readonly ok: boolean;
	readonly reason: string;
} {
	const name = baseName(path);
	if (isFrameworkReservedName(path)) {
		return { ok: true, reason: "" };
	}
	if (isTestFileName(path)) {
		const stem = name.slice(0, name.toLowerCase().indexOf(".test."));
		if (isKebabStem(stem)) {
			return { ok: true, reason: "" };
		}
		return { ok: false, reason: `test file stem "${stem}" is not kebab-case` };
	}
	const dot = name.lastIndexOf(".");
	const stem = dot < 0 ? name : name.slice(0, dot);
	if (isKebabStem(stem)) {
		return { ok: true, reason: "" };
	}
	return { ok: false, reason: `file stem "${stem}" is not kebab-case` };
}
