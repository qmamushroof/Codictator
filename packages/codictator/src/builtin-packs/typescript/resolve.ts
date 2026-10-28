// SPEC §6.1 + §4.11.3: resolution for the import extractor. Relative
// paths, nearest-tsconfig `paths`/`baseUrl`, `package.json`
// `exports`/`imports` and workspaces; bare specifiers resolve against the
// declared dependencies, and Node built-ins are never phantom (§6.4 EC-4).
// Everything here is pure string work over caller-supplied manifests, so the
// supplies stay usable from fake-port tests without touching the network.

// A snapshot of the Node built-in modules (both `fs` and `node:fs` spellings
// count; the `node:` prefix alone is sufficient below).
const BARE_BUILTINS: ReadonlyArray<string> = [
	"assert",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"dns",
	"domain",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"sys",
	"timers",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
];

// SPEC §6.4 EC-4: a built-in, never phantom.
export function isBuiltinSpecifier(spec: string): boolean {
	if (spec.startsWith("node:")) {
		return true;
	}
	const base = spec.split("/", 1)[0] ?? "";
	return BARE_BUILTINS.includes(base);
}

export function isRelativeSpecifier(spec: string): boolean {
	return (
		spec.startsWith("./") ||
		spec.startsWith("../") ||
		spec.startsWith("/") ||
		spec === "." ||
		spec === ".."
	);
}

export function isBareSpecifier(spec: string): boolean {
	return !isRelativeSpecifier(spec) && !isBuiltinSpecifier(spec);
}

function isLocalRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

// Declared names are the union of runtime and development dependencies plus
// optional ones; `peerDependencies` and `engines` are compatibility (§6.1).
export function collectDeclaredNames(manifest: unknown): Set<string> {
	const names = new Set<string>();
	if (!isLocalRecord(manifest)) {
		return names;
	}
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		const entries = recordField(manifest, section);
		if (isLocalRecord(entries)) {
			for (const name of Object.keys(entries)) {
				names.add(name);
			}
		}
	}
	return names;
}

// SPEC §6.4 EC-5: a workspace sibling declared as `workspace:*` (or any
// `workspace:` range) is allowed, never phantom.
export function isWorkspaceAllowed(spec: string, manifest: unknown): boolean {
	if (!isLocalRecord(manifest)) {
		return false;
	}
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		const entries = recordField(manifest, section);
		if (!isLocalRecord(entries)) {
			continue;
		}
		const version = recordField(entries, spec);
		if (typeof version === "string" && version.startsWith("workspace:")) {
			return true;
		}
	}
	return false;
}

// A bare import is phantom when it is neither built-in nor declared.
export function isPhantomSpecifier(
	spec: string,
	declared: ReadonlySet<string>,
): boolean {
	if (!isBareSpecifier(spec)) {
		return false;
	}
	const base = spec.startsWith("@")
		? spec.split("/", 2).join("/")
		: (spec.split("/", 1)[0] ?? "");
	return !declared.has(base);
}

// Lexical `.`/`..` collapsing over posix segments; never touches the disk.
export function normalizeImportPath(path: string): string {
	const absolute = path.startsWith("/");
	const parts = path.split("/");
	const kept: Array<string> = [];
	for (const part of parts) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			if (kept.length > 0) {
				kept.pop();
			}
			continue;
		}
		kept.push(part);
	}
	const joined = kept.join("/");
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
	const base = parentDir(fromPath);
	const joined = base === "." ? spec : `${base}/${spec}`;
	return normalizeImportPath(joined);
}

// Minimal `paths` support: exact keys first, then one single-`*` pattern
// each, longest prefix wins; the caller supplies the nearest tsconfig.
export function matchTsPaths(
	spec: string,
	paths: Readonly<Record<string, ReadonlyArray<string>>>,
	baseUrl: string,
): string | undefined {
	const exact = paths[spec];
	if (exact !== undefined && exact.length > 0) {
		const first = exact[0] ?? "";
		return normalizeImportPath(baseUrl === "." ? first : `${baseUrl}/${first}`);
	}
	let best: string | undefined;
	let bestLength = -1;
	for (const key of Object.keys(paths)) {
		const star = key.indexOf("*");
		if (star < 0) {
			continue;
		}
		const prefix = key.slice(0, star);
		const suffix = key.slice(star + 1);
		if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) {
			continue;
		}
		if (prefix.length + suffix.length <= bestLength) {
			continue;
		}
		const middle = spec.slice(prefix.length, spec.length - suffix.length);
		const targets = paths[key] ?? [];
		const target = targets[0] ?? "";
		const mapped = target.split("*").join(middle);
		best = normalizeImportPath(
			baseUrl === "." ? mapped : `${baseUrl}/${mapped}`,
		);
		bestLength = prefix.length + suffix.length;
	}
	return best;
}
