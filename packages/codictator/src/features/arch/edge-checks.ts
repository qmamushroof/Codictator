// SPEC §4.11.4: edge resolution and the boundary judgements. Every graph
// edge resolves to its modules or an external class, then each resolved edge
// is judged for public entry, declared edges and layer direction.
import type { Finding } from "../engine/index.ts";
import {
	assignModule,
	isBuiltinSpecifier,
	moduleBase,
	normalizeSeparators,
	resolveImportTarget,
} from "./graph.ts";
import type { ModuleNode } from "./index.ts";
import {
	type ArchDenyRule,
	dependsAllowed,
	isPublicEntryTarget,
	mappedFinding,
	moduleEntry,
	profileAllowsEdge,
} from "./module-mapping.ts";
import { isArchProfile, layerMayImport, resolveLayer } from "./profiles.ts";

function isExternalEntrySpecifier(spec: string): boolean {
	const target = normalizeSeparators(spec);
	if (target.startsWith("@")) {
		const rest = target.slice(1);
		const slash = rest.indexOf("/");
		if (slash < 0) {
			return true;
		}
		return rest.indexOf("/", slash + 1) < 0;
	}
	return !target.includes("/");
}

// A bare specifier with a subpath is a deep import past the package entry
// (SPEC §4.11 EC-9); built-ins stay external nodes for the item-3 scan.

function boundaryFinding(from: string, line: number, message: string): Finding {
	return {
		ruleId: "core/arch-boundaries",
		path: from,
		line,
		message,
		remediation:
			"Declare the edge in config.architecture modules[].dependsOn, or remove the import.",
	};
}

function entryFinding(
	from: string,
	line: number,
	target: string,
	entry: string,
): Finding {
	return {
		ruleId: "core/arch-public-entry",
		path: from,
		line,
		message: `cross-module import targets ${target}, outside the public entry ${entry}`,
		remediation: `Import from the module entry ${entry}, or move the shared code there.`,
	};
}

export interface ResolvedEdge {
	readonly from: string;
	readonly line: number;
	readonly to: string;
	readonly fromMod: ModuleNode | undefined;
	readonly toMod: ModuleNode | undefined;
	readonly external: "entry" | "deep" | undefined;
}

export function resolveEdge(
	modules: ReadonlyArray<ModuleNode>,
	from: string,
	line: number,
	spec: string,
): ResolvedEdge {
	const source = normalizeSeparators(from);
	const raw = normalizeSeparators(spec);
	if (raw === "dynamic:expr") {
		return {
			from: source,
			line,
			to: raw,
			fromMod: undefined,
			toMod: undefined,
			external: undefined,
		};
	}
	const resolved = resolveImportTarget(modules, source, raw);
	const fromMod = assignModule(modules, source);
	if (isBuiltinSpecifier(raw)) {
		return {
			from: source,
			line,
			to: resolved,
			fromMod,
			toMod: undefined,
			external: "entry",
		};
	}
	const assigned = assignModule(modules, resolved);
	if (assigned !== undefined) {
		return {
			from: source,
			line,
			to: resolved,
			fromMod,
			toMod: assigned,
			external: undefined,
		};
	}
	if (
		isRepoPath(resolved) ||
		raw.startsWith("./") ||
		raw.startsWith("../") ||
		raw.startsWith("/")
	) {
		return {
			from: source,
			line,
			to: resolved,
			fromMod,
			toMod: undefined,
			external: undefined,
		};
	}
	if (isExternalEntrySpecifier(raw)) {
		return {
			from: source,
			line,
			to: resolved,
			fromMod,
			toMod: undefined,
			external: "entry",
		};
	}
	return {
		from: source,
		line,
		to: resolved,
		fromMod,
		toMod: undefined,
		external: "deep",
	};
}

function isRepoPath(value: string): boolean {
	return value.startsWith("src/");
}

// SPEC §4.11.5 EC-5: a non-literal dynamic target is unresolvable. The
// finding blocks in kernel and domain code and advises elsewhere.
function dynamicFinding(
	edge: ResolvedEdge,
	fromMod: ModuleNode | undefined,
): Finding {
	const strict = fromMod?.kind === "kernel";
	return {
		ruleId: "core/arch-boundaries",
		code: "unresolvable-dynamic-import",
		path: edge.from,
		line: edge.line,
		message: strict
			? `unresolvable dynamic import in ${fromMod?.name ?? "unknown"}: kernel code must use static imports`
			: `unresolvable dynamic import at ${edge.from}:${edge.line}: the arch guard cannot judge a non-literal target`,
		remediation:
			"Replace the expression with a literal specifier so the import graph can resolve it.",
	};
}

function layerFinding(
	from: string,
	line: number,
	fromLayer: string,
	toLayer: string,
): Finding {
	return {
		ruleId: "core/arch-boundaries",
		path: from,
		line,
		message: `layer ${fromLayer} must not import layer ${toLayer}`,
		remediation:
			"Point the import down the layer direction (domain <- application <- infrastructure/ui), or move the shared code.",
	};
}

function checkLayerEdge(
	edge: ResolvedEdge,
	fromMod: ModuleNode,
	toMod: ModuleNode,
	profile: string,
	layerDirs: ReadonlyArray<string>,
): Finding | undefined {
	if (fromMod.name !== toMod.name || layerDirs.length === 0) {
		return undefined;
	}
	const base = moduleBase(fromMod);
	const fromLayer = resolveLayer(edge.from, base, layerDirs);
	const toLayer = resolveLayer(edge.to, base, layerDirs);
	if (fromLayer === undefined || toLayer === undefined) {
		return undefined;
	}
	if (
		fromLayer !== toLayer &&
		!layerMayImport(
			fromLayer,
			toLayer,
			isArchProfile(profile) ? profile : "app",
		)
	) {
		return layerFinding(edge.from, edge.line, fromLayer, toLayer);
	}
	return undefined;
}

export function checkResolvedEdge(
	edge: ResolvedEdge,
	profile: string,
	layerDirs: ReadonlyArray<string>,
	deny: ReadonlyArray<ArchDenyRule>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	const fromMod = edge.fromMod;
	if (fromMod === undefined) {
		return findings;
	}
	if (edge.to === "dynamic:expr") {
		findings.push(dynamicFinding(edge, fromMod));
		return findings;
	}
	if (edge.external === "entry") {
		return findings;
	}
	if (edge.external === "deep") {
		findings.push(
			entryFinding(edge.from, edge.line, edge.to, `${edge.to} entry`),
		);
		return findings;
	}
	const toMod = edge.toMod;
	if (toMod === undefined) {
		findings.push(
			mappedFinding(
				edge.from,
				edge.line,
				`import target ${edge.to} sits outside every architecture module`,
			),
		);
		return findings;
	}
	if (toMod.name === fromMod.name) {
		const layered = checkLayerEdge(edge, fromMod, toMod, profile, layerDirs);
		if (layered !== undefined) {
			findings.push(layered);
		}
		return findings;
	}
	const entry = moduleEntry(toMod);
	if (!isPublicEntryTarget(toMod, edge.to)) {
		findings.push(entryFinding(edge.from, edge.line, edge.to, entry));
	}
	if (
		!dependsAllowed(fromMod, toMod, deny) ||
		!profileAllowsEdge(profile, fromMod, toMod)
	) {
		findings.push(
			boundaryFinding(
				edge.from,
				edge.line,
				`module ${fromMod.name} must not import module ${toMod.name}`,
			),
		);
	}
	return findings;
}
