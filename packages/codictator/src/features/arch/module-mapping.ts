// SPEC §4.11.4: module identity and the allow policy. Entry-target matching,
// derivation of the module map from file paths, and the dependsOn, deny and
// profile predicates every cross-module edge is judged against.
import type { Finding } from "../engine/index.ts";
import { isArchProfile } from "./arch-profiles.ts";
import {
	moduleBase,
	normalizeSeparators,
	resolveRelativeSpecifier,
} from "./graph.ts";
import type { ModuleNode } from "./index.ts";

export interface ArchDenyRule {
	readonly from: string;
	readonly to: string;
}

const TYPESCRIPT_EXTENSIONS = [
	".d.ts",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
] as const;

function stripExtension(path: string): string {
	for (const extension of TYPESCRIPT_EXTENSIONS) {
		if (path.endsWith(extension)) {
			return path.slice(0, -extension.length);
		}
	}
	return path;
}

export function moduleEntry(mod: ModuleNode): string {
	if (mod.entry !== undefined) {
		return normalizeSeparators(mod.entry);
	}
	return `${moduleBase(mod)}/index.ts`;
}

// A cross-module import targets the public entry when it names the entry
// file, the entry without its extension, or the module dir itself.
export function isPublicEntryTarget(
	mod: ModuleNode,
	resolved: string,
): boolean {
	const target = normalizeSeparators(resolved);
	const entry = moduleEntry(mod);
	const base = moduleBase(mod);
	return (
		target === entry ||
		stripExtension(target) === stripExtension(entry) ||
		target === base ||
		stripExtension(target) === `${base}/index`
	);
}

function hasGeneratedSegment(path: string): boolean {
	return normalizeSeparators(path).split("/").includes("generated");
}

function isRepoPath(value: string): boolean {
	return value.startsWith("src/");
}

function submoduleForTail(
	top: string,
	tail: string,
	kind: "feature" | "pack",
): ModuleNode | undefined {
	const next = tail.indexOf("/");
	if (next < 0) {
		return undefined;
	}
	const name = tail.slice(0, next);
	if (kind === "pack") {
		return {
			name: `${top}/${name}`,
			path: `src/${top}/${name}/**`,
			kind: "pack",
			dependsOn: [],
		};
	}
	return {
		name,
		path: `src/${top}/${name}/**`,
		kind: "feature",
		dependsOn: [],
	};
}

function moduleForTop(top: string, tail: string): ModuleNode | undefined {
	if (top === "kernel") {
		return {
			name: "kernel",
			path: "src/kernel/**",
			kind: "kernel",
			dependsOn: [],
		};
	}
	if (top === "cli") {
		return {
			name: "cli",
			path: "src/cli/**",
			kind: "composition",
			dependsOn: ["*"],
		};
	}
	if (top === "features") {
		return submoduleForTail(top, tail, "feature");
	}
	if (top === "builtin-packs") {
		return submoduleForTail(top, tail, "pack");
	}
	return {
		name: top,
		path: `src/${top}/**`,
		kind: "feature",
		dependsOn: [],
	};
}

function moduleForPath(path: string): ModuleNode | undefined {
	const candidate = normalizeSeparators(path);
	if (hasGeneratedSegment(candidate) || !isRepoPath(candidate)) {
		return undefined;
	}
	const rest = candidate.slice("src/".length);
	const slash = rest.indexOf("/");
	if (slash < 0) {
		return undefined;
	}
	return moduleForTop(rest.slice(0, slash), rest.slice(slash + 1));
}

// SPEC §4.11.3 Assign for the evaluation path: without a configured map the
// modules derive from the files under src/, each with no declared edges, so
// every cross-module edge fails closed until the config map declares it.
export function deriveModules(
	refs: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): Array<ModuleNode> {
	const found = new Map<string, ModuleNode>();
	const consider = (file: string): void => {
		const mod = moduleForPath(file);
		if (mod !== undefined && !found.has(mod.name)) {
			found.set(mod.name, mod);
		}
	};
	for (const ref of refs) {
		consider(ref.from);
		const target = normalizeSeparators(ref.to);
		if (target.startsWith("./") || target.startsWith("../")) {
			consider(resolveRelativeSpecifier(ref.from, target));
		} else if (isRepoPath(target)) {
			consider(target);
		}
	}
	return [...found.values()].sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	);
}

export function dependsAllowed(
	fromMod: ModuleNode,
	toMod: ModuleNode,
	deny: ReadonlyArray<ArchDenyRule>,
): boolean {
	for (const rule of deny) {
		const fromHit = rule.from === "*" || rule.from === fromMod.name;
		const toHit = rule.to === "*" || rule.to === toMod.name;
		if (fromHit && toHit) {
			return false;
		}
	}
	if (fromMod.kind === "composition" || fromMod.dependsOn.includes("*")) {
		return true;
	}
	if (toMod.kind === "composition") {
		return false;
	}
	return fromMod.dependsOn.includes(toMod.name);
}

// SPEC §4.11.1 profile overlays beyond dependsOn: the kernel and layer
// directions the table cannot express, and the composition root nothing may
// import. Unknown kinds stay neutral so unconfigured maps fail on edges only.
export function profileAllowsEdge(
	profile: string,
	fromMod: ModuleNode,
	toMod: ModuleNode,
): boolean {
	if (
		!isArchProfile(profile) ||
		fromMod.kind === undefined ||
		toMod.kind === undefined
	) {
		return true;
	}
	if (fromMod.kind === "kernel" && toMod.name !== fromMod.name) {
		return false;
	}
	if (profile === "app" || profile === "service") {
		if (fromMod.kind === "shared" && toMod.kind === "feature") {
			return false;
		}
	}
	if (profile === "cli") {
		if (fromMod.kind === "feature" && toMod.kind === "command") {
			return false;
		}
	}
	if (profile === "service") {
		if (fromMod.kind === "feature" && toMod.kind === "transport") {
			return false;
		}
	}
	return true;
}

export function mappedFinding(
	from: string,
	line: number,
	detail: string,
): Finding {
	return {
		ruleId: "core/arch-module-mapped",
		path: from,
		line,
		message: detail,
		remediation:
			"Move the file under a config.architecture modules[] path, or add its folder to the map.",
	};
}
