// SPEC §4.11: profiles, import graph, boundary checks.
import type { CheckContext, Finding } from "../engine/index.ts";
import {
	type ArchCheckOptions,
	checkArch as checkArchImpl,
	checkArchProfile,
	checkModuleSize,
	deriveModules,
	isPublicEntryTarget,
	type ModuleSizeLimits,
	type ModuleSizeSummary,
} from "./checks.ts";
import {
	buildGraph as buildGraphImpl,
	EMPTY_GRAPH_CACHE,
	type GraphCacheEntry,
	type GraphCacheFile,
	type GraphCacheState,
	hashGraphContent,
	normalizeSeparators,
	parseGraphCache,
	resolveImportTarget,
	serializeGraphCache,
	updateGraphCache,
} from "./graph.ts";
import {
	ARCH_PROFILES,
	type ArchProfile,
	CODICTATOR_MODULES,
	CODICTATOR_PROFILE,
	isArchProfile,
	layerMayImport,
	resolveLayer,
	validateModuleMap,
} from "./profiles.ts";

export interface ImportRef {
	readonly from: string;
	readonly to: string;
	readonly line: number;
}

// SPEC §3.4: per-language import extraction.
export interface ImportExtractor {
	readonly language: string;
	readonly extensions: ReadonlyArray<string>;
	readonly extract: (path: string, text: string) => Array<ImportRef>;
}

export interface ModuleNode {
	readonly name: string;
	readonly path: string;
	readonly kind?: string;
	readonly entry?: string;
	readonly dependsOn: ReadonlyArray<string>;
}

export type {
	ArchCheckOptions,
	ArchProfile,
	GraphCacheEntry,
	GraphCacheFile,
	GraphCacheState,
	ModuleSizeLimits,
	ModuleSizeSummary,
};
export {
	ARCH_PROFILES,
	CODICTATOR_MODULES,
	CODICTATOR_PROFILE,
	checkArchProfile,
	checkModuleSize,
	deriveModules,
	EMPTY_GRAPH_CACHE,
	hashGraphContent,
	isArchProfile,
	isPublicEntryTarget,
	layerMayImport,
	normalizeSeparators,
	parseGraphCache,
	resolveImportTarget,
	resolveLayer,
	serializeGraphCache,
	updateGraphCache,
	validateModuleMap,
};

// SPEC §4.11.3: import graph construction over the module map.
export function buildGraph(
	modules: ReadonlyArray<ModuleNode>,
	refs: ReadonlyArray<ImportRef>,
): Array<ImportRef> {
	return buildGraphImpl(modules, refs);
}

// SPEC §4.11.4: boundary and layer checks for the evaluation path.
export function checkArch(
	ctx: CheckContext,
	refs: ReadonlyArray<ImportRef>,
	options: ArchCheckOptions = {},
): Promise<Array<Finding>> {
	return checkArchImpl(ctx, refs, options);
}
