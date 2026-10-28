// SPEC §4.11.1–§4.11.2: architecture profiles, layer direction and the
// module map. The §3.3 table lands here as data so the arch guard dogfoods
// the same map it enforces on every other repo.
import {
	type CdxError,
	err,
	makeError,
	ok,
	type Result,
} from "../../kernel/index.ts";
import type { ModuleNode } from "./index.ts";

// SPEC §4.11.1: the four profiles and the module kinds each one allows.
export const ARCH_PROFILES = ["app", "library", "cli", "service"] as const;

export type ArchProfile = (typeof ARCH_PROFILES)[number];

export function isArchProfile(value: string): value is ArchProfile {
	return (ARCH_PROFILES as ReadonlyArray<string>).includes(value);
}

// SPEC §4.11.1: folder names are configurable, the direction is not. A layer
// maps to the lower layers plus kernel it may import.
const APP_LAYER_ORDER: Readonly<Record<string, ReadonlyArray<string>>> = {
	domain: ["domain"],
	application: ["domain", "application"],
	infrastructure: ["domain", "application", "infrastructure"],
	ui: ["domain", "application", "ui"],
	api: ["domain", "application", "api"],
};

export function layerMayImport(
	layer: string,
	target: string,
	profile: ArchProfile,
): boolean {
	if (target === "kernel") {
		return true;
	}
	if (profile !== "app" && profile !== "service") {
		return true;
	}
	const allowed = APP_LAYER_ORDER[layer];
	if (allowed === undefined) {
		return true;
	}
	return allowed.includes(target);
}

// SPEC §4.11.1: the first matching folder segment under the module dir names
// the layer; a file outside every configured layer dir is unlayered.
export function resolveLayer(
	file: string,
	moduleBase: string,
	layerDirs: ReadonlyArray<string>,
): string | undefined {
	const prefix = `${moduleBase}/`;
	if (!file.startsWith(prefix)) {
		return undefined;
	}
	const rest = file.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash < 0) {
		return undefined;
	}
	const top = rest.slice(0, slash);
	if (!layerDirs.includes(top)) {
		return undefined;
	}
	return top;
}

// SPEC §3.3: every module row as data. "dependsOn" mirrors the "may import"
// column; the composition root depends on everything and nothing imports it.
export const CODICTATOR_PROFILE: ArchProfile = "app";

export const CODICTATOR_MODULES: ReadonlyArray<ModuleNode> = [
	{ name: "kernel", path: "src/kernel/**", kind: "kernel", dependsOn: [] },
	{
		name: "config",
		path: "src/features/config/**",
		kind: "feature",
		dependsOn: ["kernel"],
	},
	{
		name: "engine",
		path: "src/features/engine/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "audit"],
	},
	{
		name: "packs",
		path: "src/features/packs/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "adapters",
		path: "src/features/adapters/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "steering"],
	},
	{
		name: "steering",
		path: "src/features/steering/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "workflow"],
	},
	{
		name: "security",
		path: "src/features/security/**",
		kind: "feature",
		dependsOn: ["kernel", "engine"],
	},
	{
		name: "deps",
		path: "src/features/deps/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "records",
		path: "src/features/records/**",
		kind: "feature",
		dependsOn: ["kernel", "engine"],
	},
	{
		name: "testing",
		path: "src/features/testing/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "arch",
		path: "src/features/arch/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "workflow",
		path: "src/features/workflow/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "testing", "audit"],
	},
	{
		name: "remediation",
		path: "src/features/remediation/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "deps", "arch", "workflow"],
	},
	{
		name: "integrity",
		path: "src/features/integrity/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "ci",
		path: "src/features/ci/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "generator",
		path: "src/features/generator/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "packs", "llm"],
	},
	{
		name: "llm",
		path: "src/features/llm/**",
		kind: "feature",
		dependsOn: ["kernel"],
	},
	{
		name: "audit",
		path: "src/features/audit/**",
		kind: "feature",
		dependsOn: ["kernel"],
	},
	{
		name: "builtin-packs/core",
		path: "src/builtin-packs/core/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "builtin-packs/typescript",
		path: "src/builtin-packs/typescript/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "builtin-packs/dotnet",
		path: "src/builtin-packs/dotnet/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "builtin-packs/python",
		path: "src/builtin-packs/python/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "cli",
		path: "src/cli/**",
		kind: "composition",
		dependsOn: ["*"],
	},
];

function cycleError(trail: ReadonlyArray<string>): CdxError {
	return makeError(
		"CDX-E105",
		`architecture change closes a cycle: ${trail.join(" -> ")}`,
		"Remove a dependsOn edge so the module graph stays acyclic (SPEC §4.11.2).",
	);
}

// SPEC §4.11.2: adding a dependsOn edge is a design change, allowed only
// when the graph stays acyclic. Config validation owns the same check; this
// pure form lets the arch guard refuse a cyclic map with CDX-E105.
export function validateModuleMap(
	modules: ReadonlyArray<ModuleNode>,
): Result<ReadonlyArray<ModuleNode>> {
	const deps = new Map<string, ReadonlyArray<string>>();
	for (const mod of modules) {
		if (deps.has(mod.name)) {
			return err(
				makeError(
					"CDX-E105",
					`duplicate module name "${mod.name}"`,
					"Give every architecture module a unique name, then retry.",
				),
			);
		}
		deps.set(mod.name, mod.dependsOn);
	}
	for (const mod of modules) {
		for (const dep of mod.dependsOn) {
			if (dep !== "*" && !deps.has(dep)) {
				return err(
					makeError(
						"CDX-E105",
						`module "${mod.name}" depends on unknown module "${dep}"`,
						"Point dependsOn at a module the architecture map declares, then retry.",
					),
				);
			}
		}
	}
	const visiting = new Set<string>();
	const done = new Set<string>();
	const walk = (
		name: string,
		trail: ReadonlyArray<string>,
	): CdxError | undefined => {
		if (done.has(name)) {
			return undefined;
		}
		if (visiting.has(name)) {
			return cycleError([...trail.slice(trail.indexOf(name)), name]);
		}
		visiting.add(name);
		for (const dep of deps.get(name) ?? []) {
			if (dep === "*") {
				continue;
			}
			const found = walk(dep, [...trail, name]);
			if (found !== undefined) {
				return found;
			}
		}
		visiting.delete(name);
		done.add(name);
		return undefined;
	};
	for (const mod of modules) {
		const found = walk(mod.name, []);
		if (found !== undefined) {
			return err(found);
		}
	}
	return ok(modules);
}
