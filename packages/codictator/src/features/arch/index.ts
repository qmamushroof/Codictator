// SPEC §4.11: profiles, import graph, boundary checks.
import type { CheckContext, Finding } from "../engine/index.ts";

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
	readonly dependsOn: ReadonlyArray<string>;
}

// SPEC §4.11.3: import graph construction over the module map.
export function buildGraph(
	_modules: ReadonlyArray<ModuleNode>,
	_refs: ReadonlyArray<ImportRef>,
): ReadonlyArray<ImportRef> {
	throw new Error("not implemented: SPEC §4.11.3");
}

// SPEC §4.11.4: boundary and layer checks for the evaluation path.
export function checkArch(
	_ctx: CheckContext,
	_refs: ReadonlyArray<ImportRef>,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.11.4");
}
