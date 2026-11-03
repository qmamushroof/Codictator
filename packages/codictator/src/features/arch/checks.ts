// SPEC §4.11.4: the architecture checks. Cycle, profile and module-size
// fitness checks plus the checkArch orchestration over the module-mapping
// and edge-checks modules.
import type { CheckContext, Finding } from "../engine/index.ts";
import { isArchProfile } from "./arch-profiles.ts";
import { findModuleCycle } from "./cycle-walk.ts";
import {
	checkResolvedEdge,
	type ResolvedEdge,
	resolveEdge,
} from "./edge-checks.ts";
import type { ModuleNode } from "./index.ts";
import {
	type ArchDenyRule,
	deriveModules,
	mappedFinding,
} from "./module-mapping.ts";

export interface ArchCheckOptions {
	readonly modules?: ReadonlyArray<ModuleNode>;
	readonly profile?: string;
	readonly layerDirs?: ReadonlyArray<string>;
	readonly deny?: ReadonlyArray<ArchDenyRule>;
}

// SPEC §4.11.4 core/arch-no-cycles: Tarjan over the resolved module edges;
// L1 judges only cycles through new edges, so the message prints the cycle.
function addEdgeToGraph(
	depends: Map<string, Array<string>>,
	edgeAt: Map<string, ResolvedEdge>,
	edge: ResolvedEdge,
): void {
	if (
		edge.fromMod === undefined ||
		edge.toMod === undefined ||
		edge.fromMod.name === edge.toMod.name
	) {
		return;
	}
	const list = depends.get(edge.fromMod.name) ?? [];
	if (!list.includes(edge.toMod.name)) {
		list.push(edge.toMod.name);
		list.sort();
	}
	depends.set(edge.fromMod.name, list);
	const key = `${edge.fromMod.name}|${edge.toMod.name}`;
	if (!edgeAt.has(key)) {
		edgeAt.set(key, edge);
	}
}

function collectArchGraph(edges: ReadonlyArray<ResolvedEdge>): {
	readonly depends: Map<string, Array<string>>;
	readonly edgeAt: Map<string, ResolvedEdge>;
} {
	const depends = new Map<string, Array<string>>();
	const edgeAt = new Map<string, ResolvedEdge>();
	for (const edge of edges) {
		addEdgeToGraph(depends, edgeAt, edge);
	}
	return { depends, edgeAt };
}

function cycleFindingFor(
	cycle: ReadonlyArray<string>,
	edgeAt: ReadonlyMap<string, ResolvedEdge>,
): Finding {
	const finding: Finding = {
		ruleId: "core/arch-no-cycles",
		message: `module cycle closes through new edges: ${cycle.join(" -> ")}`,
		remediation: "Remove one edge of the cycle, or merge the modules.",
	};
	const first = edgeAt.get(`${cycle[0]}|${cycle[1] ?? ""}`);
	if (first === undefined) {
		return finding;
	}
	return { ...finding, path: first.from, line: first.line };
}

function checkCycles(edges: ReadonlyArray<ResolvedEdge>): Array<Finding> {
	const { depends, edgeAt } = collectArchGraph(edges);
	const names = [...depends.keys()].sort();
	const cycle = findModuleCycle(names, depends);
	if (cycle === undefined) {
		return [];
	}
	return [cycleFindingFor(cycle, edgeAt)];
}

// SPEC §4.11.4 core/arch-profile-declared: the profile is set and every
// module kind is valid for it.
export function checkArchProfile(
	profile: string | undefined,
	modules: ReadonlyArray<ModuleNode>,
): Array<Finding> {
	if (profile === undefined) {
		return [];
	}
	if (!isArchProfile(profile)) {
		return [
			{
				ruleId: "core/arch-profile-declared",
				message: `unknown architecture profile "${profile}"`,
				remediation: "Use one of app, library, cli or service (SPEC §4.11.1).",
			},
		];
	}
	const valid: Readonly<Record<string, ReadonlyArray<string>>> = {
		app: ["feature", "shared", "kernel", "composition"],
		library: ["public", "internal", "kernel"],
		cli: ["command", "feature", "kernel", "composition"],
		service: ["transport", "feature", "shared", "kernel", "composition"],
	};
	const allowed = valid[profile] ?? [];
	return modules
		.filter((mod) => mod.kind !== undefined && !allowed.includes(mod.kind))
		.map((mod) => ({
			ruleId: "core/arch-profile-declared",
			message: `module ${mod.name} has kind "${mod.kind ?? ""}", invalid for profile ${profile}`,
			remediation: `Give the module a kind ${profile} allows (${allowed.join(", ")}).`,
		}));
}

export interface ModuleSizeSummary {
	readonly module: string;
	readonly files: number;
	readonly lines: number;
}

export interface ModuleSizeLimits {
	readonly maxFiles?: number;
	readonly maxLines?: number;
}

// SPEC §4.11.4 core/arch-module-size: the fitness function over per-module
// file and line counts. Without limits it only reports the summary.
export function checkModuleSize(
	summary: ReadonlyArray<ModuleSizeSummary>,
	limits: ModuleSizeLimits = {},
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const row of summary) {
		if (limits.maxFiles !== undefined && row.files > limits.maxFiles) {
			findings.push({
				ruleId: "core/arch-module-size",
				message: `module ${row.module} holds ${row.files} files, over the limit ${limits.maxFiles}`,
				remediation:
					"Split the module along responsibilities, never mechanically at the limit.",
			});
		}
		if (limits.maxLines !== undefined && row.lines > limits.maxLines) {
			findings.push({
				ruleId: "core/arch-module-size",
				message: `module ${row.module} holds ${row.lines} lines, over the limit ${limits.maxLines}`,
				remediation:
					"Split the module along responsibilities, never mechanically at the limit.",
			});
		}
	}
	return findings;
}

function findingKey(finding: Finding): string {
	return JSON.stringify([
		finding.ruleId,
		finding.path ?? "",
		finding.line ?? 0,
		finding.code ?? "",
		finding.message,
	]);
}

function compareFindings(left: Finding, right: Finding): number {
	if (left.ruleId !== right.ruleId) {
		return left.ruleId < right.ruleId ? -1 : 1;
	}
	const leftPath = left.path ?? "";
	const rightPath = right.path ?? "";
	if (leftPath !== rightPath) {
		return leftPath < rightPath ? -1 : 1;
	}
	return (left.line ?? 0) - (right.line ?? 0);
}

function dedupeFindings(findings: ReadonlyArray<Finding>): Array<Finding> {
	const seen = new Set<string>();
	const kept: Array<Finding> = [];
	for (const finding of findings) {
		const key = findingKey(finding);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		kept.push(finding);
	}
	kept.sort(compareFindings);
	return kept;
}

// SPEC §4.11.4: the boundary and layering checks for the evaluation path.
// Without a configured map the modules derive from the refs and every
// cross-module edge fails closed, so L1 blocks a violation before it exists.
export async function checkArch(
	ctx: CheckContext,
	refs: ReadonlyArray<{
		readonly from: string;
		readonly to: string;
		readonly line: number;
	}>,
	options: ArchCheckOptions = {},
): Promise<Array<Finding>> {
	void ctx;
	const modules = options.modules ?? deriveModules(refs);
	const profile = options.profile ?? "app";
	const layerDirs = options.layerDirs ?? [];
	const deny = options.deny ?? [];
	const ordered = [...refs].sort((left, right) =>
		left.from < right.from
			? -1
			: left.from > right.from
				? 1
				: left.line - right.line,
	);
	const edges = ordered.map((ref) =>
		resolveEdge(modules, ref.from, ref.line, ref.to),
	);
	const findings: Array<Finding> = [];
	const unmappedFrom = new Map<string, number>();
	for (const edge of edges) {
		if (edge.fromMod === undefined) {
			const first = unmappedFrom.get(edge.from);
			if (first === undefined || edge.line < first) {
				unmappedFrom.set(edge.from, edge.line);
			}
		}
	}
	for (const from of [...unmappedFrom.keys()].sort()) {
		findings.push(
			mappedFinding(
				from,
				unmappedFrom.get(from) ?? 1,
				`source file ${from} sits outside every architecture module`,
			),
		);
	}
	for (const edge of edges) {
		findings.push(...checkResolvedEdge(edge, profile, layerDirs, deny));
	}
	findings.push(...checkCycles(edges));
	findings.push(...checkArchProfile(options.profile, modules));
	return dedupeFindings(findings);
}
