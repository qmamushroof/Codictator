// SPEC §4.11.4: the architecture checks. Every edge the graph resolves is
// judged for module mapping, boundaries, public entry and cycles; the
// profile, layer and size checks run on the inputs that carry their data.
import type { CheckContext, Finding } from "../engine/index.ts";
import {
	assignModule,
	isBuiltinSpecifier,
	moduleBase,
	normalizeSeparators,
	resolveImportTarget,
	resolveRelativeSpecifier,
} from "./graph.ts";
import type { ModuleNode } from "./index.ts";
import { isArchProfile, layerMayImport, resolveLayer } from "./profiles.ts";

export interface ArchDenyRule {
	readonly from: string;
	readonly to: string;
}

export interface ArchCheckOptions {
	readonly modules?: ReadonlyArray<ModuleNode>;
	readonly profile?: string;
	readonly layerDirs?: ReadonlyArray<string>;
	readonly deny?: ReadonlyArray<ArchDenyRule>;
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

function moduleEntry(mod: ModuleNode): string {
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
	const top = rest.slice(0, slash);
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
	if (top === "testing") {
		return {
			name: "testing",
			path: "src/testing/**",
			kind: "feature",
			dependsOn: [],
		};
	}
	if (top === "features") {
		const tail = rest.slice(slash + 1);
		const next = tail.indexOf("/");
		if (next < 0) {
			return undefined;
		}
		const name = tail.slice(0, next);
		return {
			name,
			path: `src/features/${name}/**`,
			kind: "feature",
			dependsOn: [],
		};
	}
	if (top === "builtin-packs") {
		const tail = rest.slice(slash + 1);
		const next = tail.indexOf("/");
		if (next < 0) {
			return undefined;
		}
		const pack = tail.slice(0, next);
		return {
			name: `builtin-packs/${pack}`,
			path: `src/builtin-packs/${pack}/**`,
			kind: "pack",
			dependsOn: [],
		};
	}
	return {
		name: top,
		path: `src/${top}/**`,
		kind: "feature",
		dependsOn: [],
	};
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

function dependsAllowed(
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
function profileAllowsEdge(
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

function mappedFinding(from: string, line: number, detail: string): Finding {
	return {
		ruleId: "core/arch-module-mapped",
		path: from,
		line,
		message: detail,
		remediation:
			"Move the file under a config.architecture modules[] path, or add its folder to the map.",
	};
}

interface ResolvedEdge {
	readonly from: string;
	readonly line: number;
	readonly to: string;
	readonly fromMod: ModuleNode | undefined;
	readonly toMod: ModuleNode | undefined;
	readonly external: "entry" | "deep" | undefined;
}

function resolveEdge(
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

function checkResolvedEdge(
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

function moduleCycle(
	names: ReadonlyArray<string>,
	depends: ReadonlyMap<string, ReadonlyArray<string>>,
): Array<string> | undefined {
	const visiting = new Set<string>();
	const done = new Set<string>();
	const walk = (
		name: string,
		trail: ReadonlyArray<string>,
	): Array<string> | undefined => {
		if (done.has(name)) {
			return undefined;
		}
		if (visiting.has(name)) {
			return [...trail.slice(trail.indexOf(name)), name];
		}
		visiting.add(name);
		for (const dep of depends.get(name) ?? []) {
			const found = walk(dep, [...trail, name]);
			if (found !== undefined) {
				return found;
			}
		}
		visiting.delete(name);
		done.add(name);
		return undefined;
	};
	for (const name of names) {
		const found = walk(name, []);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

// SPEC §4.11.4 core/arch-no-cycles: Tarjan over the resolved module edges;
// L1 judges only cycles through new edges, so the message prints the cycle.
function checkCycles(edges: ReadonlyArray<ResolvedEdge>): Array<Finding> {
	const depends = new Map<string, Array<string>>();
	const edgeAt = new Map<string, ResolvedEdge>();
	for (const edge of edges) {
		if (
			edge.fromMod === undefined ||
			edge.toMod === undefined ||
			edge.fromMod.name === edge.toMod.name
		) {
			continue;
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
	const names = [...depends.keys()].sort();
	const cycle = moduleCycle(names, depends);
	if (cycle === undefined) {
		return [];
	}
	const first = edgeAt.get(`${cycle[0]}|${cycle[1] ?? ""}`);
	const cycleFinding: Finding = {
		ruleId: "core/arch-no-cycles",
		message: `module cycle closes through new edges: ${cycle.join(" -> ")}`,
		remediation: "Remove one edge of the cycle, or merge the modules.",
	};
	if (first === undefined) {
		return [cycleFinding];
	}
	return [{ ...cycleFinding, path: first.from, line: first.line }];
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

function dedupeFindings(findings: ReadonlyArray<Finding>): Array<Finding> {
	const seen = new Set<string>();
	const kept: Array<Finding> = [];
	for (const finding of findings) {
		const key = JSON.stringify([
			finding.ruleId,
			finding.path ?? "",
			finding.line ?? 0,
			finding.code ?? "",
			finding.message,
		]);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		kept.push(finding);
	}
	kept.sort((left, right) => {
		if (left.ruleId !== right.ruleId) {
			return left.ruleId < right.ruleId ? -1 : 1;
		}
		const leftPath = left.path ?? "";
		const rightPath = right.path ?? "";
		if (leftPath !== rightPath) {
			return leftPath < rightPath ? -1 : 1;
		}
		return (left.line ?? 0) - (right.line ?? 0);
	});
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
