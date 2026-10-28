// SPEC §4.11.3: the language-neutral import graph. Path handling,
// module assignment and the content-hash cache live here; the per-language
// lexers feed it through the ImportExtractor contract (§3.4).
import {
	err,
	makeError,
	normalizeText,
	ok,
	parseJson,
	type Result,
	sha256Text,
	stableStringify,
} from "../../kernel/index.ts";
import type { ImportRef, ModuleNode } from "./index.ts";

// SPEC §4.11 EC-13: Windows separators normalise before resolution.
export function normalizeSeparators(path: string): string {
	return path.split("\\").join("/");
}

function splitSegments(path: string): Array<string> {
	return path.split("/");
}

function joinSegments(parts: ReadonlyArray<string>): string {
	return parts.join("/");
}

// Lexical `.`/`..` collapsing over posix segments; never touches the disk.
export function normalizeImportPath(path: string): string {
	const absolute = path.startsWith("/");
	const kept: Array<string> = [];
	for (const part of splitSegments(path)) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			kept.pop();
			continue;
		}
		kept.push(part);
	}
	const joined = joinSegments(kept);
	return absolute ? `/${joined}` : joined;
}

function parentDir(path: string): string {
	const slash = path.lastIndexOf("/");
	if (slash < 0) {
		return ".";
	}
	if (slash === 0) {
		return "/";
	}
	return path.slice(0, slash);
}

// Relative resolution against the importing file, separators normalised.
export function resolveRelativeSpecifier(
	fromPath: string,
	spec: string,
): string {
	const from = normalizeSeparators(fromPath);
	const target = normalizeSeparators(spec);
	const joined =
		parentDir(from) === "." ? target : `${parentDir(from)}/${target}`;
	return normalizeImportPath(joined);
}

export function isRelativeSpecifier(spec: string): boolean {
	return (
		spec.startsWith("./") ||
		spec.startsWith("../") ||
		spec === "." ||
		spec === ".."
	);
}

export function isBuiltinSpecifier(spec: string): boolean {
	return spec.startsWith("node:") || spec === "node";
}

// The `path` glob is a literal prefix ending in `/**`; the first module
// whose prefix holds the file owns it (§4.11.3 Assign).
export function moduleBase(mod: ModuleNode): string {
	const raw = normalizeSeparators(mod.path);
	return raw.endsWith("/**") ? raw.slice(0, -3) : raw;
}

export function assignModule(
	modules: ReadonlyArray<ModuleNode>,
	file: string,
): ModuleNode | undefined {
	const candidate = normalizeSeparators(file);
	for (const mod of modules) {
		const base = moduleBase(mod);
		if (candidate === base || candidate.startsWith(`${base}/`)) {
			return mod;
		}
	}
	return undefined;
}

// An "@name/..." specifier names a module only when the map declares it;
// otherwise the checks judge it as an external package specifier.
export function resolveAliasSpecifier(
	modules: ReadonlyArray<ModuleNode>,
	spec: string,
): string | undefined {
	const target = normalizeSeparators(spec);
	if (!target.startsWith("@")) {
		return undefined;
	}
	const rest = target.slice(1);
	const slash = rest.indexOf("/");
	if (slash < 0) {
		return undefined;
	}
	const name = rest.slice(0, slash);
	const tail = rest.slice(slash + 1);
	const mod = modules.find(
		(entry) => entry.name === name || entry.name.endsWith(`/${name}`),
	);
	if (mod === undefined) {
		return undefined;
	}
	return tail === "" ? moduleBase(mod) : `${moduleBase(mod)}/${tail}`;
}

// SPEC §4.11.3 Extract+Resolve: separators first, then relative targets
// resolve against the importer. External package targets stay as written so
// the checks judge entry versus deep imports on the specifier.
export function resolveImportTarget(
	modules: ReadonlyArray<ModuleNode>,
	from: string,
	spec: string,
): string {
	const source = normalizeSeparators(from);
	const target = normalizeSeparators(spec);
	if (isRelativeSpecifier(target)) {
		return resolveRelativeSpecifier(source, target);
	}
	const aliased = resolveAliasSpecifier(modules, target);
	if (aliased !== undefined) {
		return normalizeImportPath(aliased);
	}
	if (!target.includes("/") || target.startsWith("@")) {
		return target;
	}
	if (target.includes("://") || target.startsWith("/")) {
		return normalizeImportPath(target);
	}
	return normalizeImportPath(target);
}

// SPEC §4.11.3: import graph construction over the module map. Pure:
// normalise, resolve, then hand the resolved edges to the checks. Cyclic
// dependsOn is a config error (CDX-E105 at validation); the graph itself
// never throws so L1 can judge a single new edge.
export function buildGraph(
	modules: ReadonlyArray<ModuleNode>,
	refs: ReadonlyArray<ImportRef>,
): Array<ImportRef> {
	const seen = new Set<string>();
	const edges: Array<ImportRef> = [];
	for (const ref of refs) {
		const from = normalizeSeparators(ref.from);
		const to = resolveImportTarget(modules, ref.from, ref.to);
		const key = JSON.stringify([from, to, ref.line]);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		edges.push({ from, to, line: ref.line });
	}
	edges.sort((left, right) =>
		left.from < right.from
			? -1
			: left.from > right.from
				? 1
				: left.to < right.to
					? -1
					: left.to > right.to
						? 1
						: left.line - right.line,
	);
	return edges;
}

// SPEC §4.11.3 Cache: `.codictator/cache/graph.json` keyed by file content
// hash, so L1 re-lexes only the edited file. The cache is pure data; the CLI
// owns the file it persists in (phase 9), the extractor stays injected so
// tests run without I/O.
export interface GraphCacheEntry {
	readonly hash: string;
	readonly refs: ReadonlyArray<ImportRef>;
}

export interface GraphCacheState {
	readonly version: 1;
	readonly entries: Readonly<Record<string, GraphCacheEntry>>;
}

export const EMPTY_GRAPH_CACHE: GraphCacheState = { version: 1, entries: {} };

export function hashGraphContent(text: string): string {
	return sha256Text(normalizeText(text));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (the config validate.ts pattern).
function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function isGraphCacheState(value: unknown): value is GraphCacheState {
	if (!isRecord(value)) {
		return false;
	}
	if (field(value, "version") !== 1) {
		return false;
	}
	const entries = field(value, "entries");
	return typeof entries === "object" && entries !== null;
}

export function parseGraphCache(text: string): Result<GraphCacheState> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return parsed;
	}
	if (!isGraphCacheState(parsed.value)) {
		return err(
			makeError(
				"CDX-E101",
				"graph cache is not a version 1 cache state",
				"Delete .codictator/cache/graph.json so the arch guard rebuilds it, then retry.",
			),
		);
	}
	return ok(parsed.value);
}

export function serializeGraphCache(cache: GraphCacheState): string {
	return stableStringify(cache);
}

export interface GraphCacheFile {
	readonly path: string;
	readonly text: string;
}

// Re-lex only added and changed files; dropped files leave the cache.
export function updateGraphCache(
	cache: GraphCacheState,
	files: ReadonlyArray<GraphCacheFile>,
	extract: (path: string, text: string) => ReadonlyArray<ImportRef>,
): { readonly cache: GraphCacheState; readonly refs: Array<ImportRef> } {
	const entries: Record<string, GraphCacheEntry> = {};
	const refs: Array<ImportRef> = [];
	const seen = new Set<string>();
	for (const file of files) {
		const path = normalizeSeparators(file.path);
		if (seen.has(path)) {
			continue;
		}
		seen.add(path);
		const hash = hashGraphContent(file.text);
		const cached = cache.entries[path];
		const fileRefs =
			cached !== undefined && cached.hash === hash
				? cached.refs
				: [...extract(path, file.text)].map((ref) => ({
						from: normalizeSeparators(ref.from),
						to: normalizeSeparators(ref.to),
						line: ref.line,
					}));
		entries[path] = { hash, refs: fileRefs };
		refs.push(...fileRefs);
	}
	return { cache: { version: 1, entries }, refs };
}
