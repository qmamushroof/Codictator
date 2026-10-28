// SPEC §6.1 `core/compiler-strict`: every `tsconfig*.json` used by a build
// or test carries the strict flags; JavaScript projects add `allowJs` plus
// `checkJs` with the same flags. `extends` chains resolve to an effective
// set (§6.4 EC-2) and a JS repo without TypeScript proposes it (§6.4 EC-9).
import { parseJson } from "../../kernel/index.ts";

// The ten flags SPEC §6.1 requires on every TypeScript project.
export const TYPESCRIPT_STRICT_FLAGS: ReadonlyArray<string> = [
	"strict",
	"noUncheckedIndexedAccess",
	"exactOptionalPropertyTypes",
	"noImplicitOverride",
	"noImplicitReturns",
	"noFallthroughCasesInSwitch",
	"noUnusedLocals",
	"noUnusedParameters",
	"useUnknownInCatchVariables",
	"forceConsistentCasingInFileNames",
];

const EXTENDS_DEPTH_LIMIT = 10;

function isLocalRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function readOptions(manifest: unknown): Record<string, unknown> {
	if (!isLocalRecord(manifest)) {
		return {};
	}
	const options = recordField(manifest, "compilerOptions");
	if (!isLocalRecord(options)) {
		return {};
	}
	return { ...options };
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

function joinDir(dir: string, spec: string): string {
	if (spec.startsWith("/")) {
		return spec;
	}
	const parts = (dir === "." ? [] : dir.split("/")).concat(spec.split("/"));
	const kept: Array<string> = [];
	for (const part of parts) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			kept.pop();
			continue;
		}
		kept.push(part);
	}
	return kept.join("/");
}

// Follows relative `extends` only; a bare package base (for example a shared
// preset) stops the chain instead of reaching the network. Cycles and absurd
// depths stop too, and the innermost file wins each key.
export function resolveEffectiveOptions(
	entryPath: string,
	files: Readonly<Record<string, string>>,
): Record<string, unknown> {
	const seen = new Set<string>();
	const chain: Array<Record<string, unknown>> = [];
	let current: string | undefined = entryPath;
	let depth = 0;
	while (current !== undefined && depth < EXTENDS_DEPTH_LIMIT) {
		if (seen.has(current)) {
			break;
		}
		seen.add(current);
		const text = files[current];
		if (text === undefined) {
			break;
		}
		const parsed = parseJson(text);
		if (!parsed.ok || !isLocalRecord(parsed.value)) {
			break;
		}
		chain.push(readOptions(parsed.value));
		const parent = recordField(parsed.value, "extends");
		if (typeof parent !== "string") {
			break;
		}
		if (!parent.startsWith(".")) {
			break;
		}
		const withJson = parent.endsWith(".json") ? parent : `${parent}.json`;
		current = joinDir(parentDir(current), withJson);
		depth += 1;
	}
	const merged: Record<string, unknown> = {};
	for (let index = chain.length - 1; index >= 0; index -= 1) {
		const options = chain[index] ?? {};
		for (const key of Object.keys(options)) {
			merged[key] = options[key];
		}
	}
	return merged;
}

// Every required flag must be exactly `true`; `false` and absent both fail.
export function missingStrictFlags(
	options: Readonly<Record<string, unknown>>,
): Array<string> {
	return TYPESCRIPT_STRICT_FLAGS.filter((flag) => options[flag] !== true);
}

function hasExtension(
	names: ReadonlyArray<string>,
	extensions: ReadonlyArray<string>,
): boolean {
	return names.some((name) => {
		const lowered = name.toLowerCase();
		return extensions.some((extension) => lowered.endsWith(extension));
	});
}

// SPEC §6.4 EC-9: a repo with JavaScript sources but no TypeScript sources
// owes `checkJs` (with the strict flags) and a TypeScript dev dependency.
export function isJavaScriptOnlyRepo(
	fileNames: ReadonlyArray<string>,
): boolean {
	const scriptSources = [".ts", ".tsx", ".mts", ".cts"];
	const javaSources = [".js", ".jsx", ".mjs", ".cjs"];
	return (
		!hasExtension(fileNames, scriptSources) &&
		hasExtension(fileNames, javaSources)
	);
}

export function missingCheckJsFlags(
	options: Readonly<Record<string, unknown>>,
): Array<string> {
	const missing: Array<string> = [];
	const allowKey = "allowJs";
	const checkKey = "checkJs";
	const allowJs: unknown = options[allowKey];
	const checkJs: unknown = options[checkKey];
	if (allowJs !== true) {
		missing.push("allowJs");
	}
	if (checkJs !== true) {
		missing.push("checkJs");
	}
	for (const flag of missingStrictFlags(options)) {
		missing.push(flag);
	}
	return missing;
}

export function proposesTypescript(manifest: unknown): boolean {
	if (!isLocalRecord(manifest)) {
		return true;
	}
	const dev = recordField(manifest, "devDependencies");
	if (!isLocalRecord(dev)) {
		return true;
	}
	return recordField(dev, "typescript") === undefined;
}
