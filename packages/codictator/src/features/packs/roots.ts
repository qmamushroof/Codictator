// SPEC §4.4.1 pack case data: the roots of the packs Codictator loads for a
// repo, computed once per command from the loaded config. A built-in pack's
// directory counts only when the engine itself sits inside the repo tree (this
// workspace); a consumer repo holds no built-in pack directories. A custom
// pack counts by the `path` its config.packs entry names. A pack.json found on
// disk never adds a root (BUG-0102).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_PACK_IDS } from "./manifest.ts";

function repoRelative(repoRoot: string, target: string): string | undefined {
	const rel = path.relative(repoRoot, target);
	if (path.isAbsolute(rel) || rel.split(path.sep)[0] === "..") {
		return undefined;
	}
	return rel.split(path.sep).join("/");
}

// The engine package is two levels above features/packs, in src and in dist
// alike; the committed fixtures live under src, a build copies them to dist.
export function builtinPackRoots(repoRoot: string): Array<string> {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const pkg = path.resolve(here, "..", "..", "..");
	const roots: Array<string> = [];
	for (const dir of ["src", "dist"]) {
		for (const id of BUILTIN_PACK_IDS) {
			const rel = repoRelative(
				repoRoot,
				path.join(pkg, dir, "builtin-packs", id),
			);
			if (rel !== undefined && !rel.split("/").includes("node_modules")) {
				roots.push(rel);
			}
		}
	}
	return roots;
}

function customRoot(entryPath: unknown): string | undefined {
	if (typeof entryPath !== "string" || entryPath === "") {
		return undefined;
	}
	const slashed = entryPath.replaceAll("\\", "/");
	if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
		return undefined;
	}
	const normal = path.posix.normalize(slashed).replace(/\/+$/, "");
	if (normal === ".." || normal.startsWith("../")) {
		return undefined;
	}
	return normal === "." ? "" : normal;
}

export function loadedPackRoots(
	repoRoot: string,
	entries: ReadonlyArray<{ readonly id: string; readonly path?: unknown }>,
): Array<string> {
	const roots = builtinPackRoots(repoRoot);
	for (const entry of entries) {
		const root = customRoot(entry.path);
		if (root !== undefined) {
			roots.push(root);
		}
	}
	return [...new Set(roots)].sort();
}
