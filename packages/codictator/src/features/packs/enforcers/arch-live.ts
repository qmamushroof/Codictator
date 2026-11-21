// SPEC §4.11.4: L1 judges a live write against the configured module map,
// so a boundary violation is blocked before it exists. The map is the
// consumer's `config.architecture` (§4.11.2); without a configured map there
// is nothing to judge and the rules stay quiet (the profile rule owns a
// missing map). Only a whole-file write of a non-test TypeScript source is
// judged: the call carries the resulting file, an edit fragment does not.
// Cycle judging reads the module files already on disk, once, and reports a
// cycle only when the call's own edges close it.
import type { Ports } from "../../../kernel/index.ts";
import { parseJson } from "../../../kernel/index.ts";
import {
	type ArchCheckOptions,
	assignModule,
	checkArch,
	type ImportRef,
	type ModuleNode,
	mappedFinding,
} from "../../arch/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import { isTestPath } from "../../workflow/writes.ts";
import { field, isRecord } from "../manifest.ts";
import type { RuleBinding } from "./binding.ts";
import { extractLiteralSpecifiers } from "./health-lex-imports.ts";
import { isTsFile } from "./health-measures.ts";
import { effectiveFiles } from "./pre-tool-files.ts";

// The existing graph read for cycle judging stops here; the call's own
// edges are always judged.
const MAX_GRAPH_FILES = 500;
const CONFIG_PATH = ".codictator/config.json";

interface ArchSetup {
	readonly modules: ReadonlyArray<ModuleNode>;
	readonly options: ArchCheckOptions;
}

function moduleNode(raw: unknown): ModuleNode | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const name = field(raw, "name");
	const path = field(raw, "path");
	const kind = field(raw, "kind");
	const entry = field(raw, "entry");
	const dependsOn = field(raw, "dependsOn");
	if (typeof name !== "string" || typeof path !== "string") {
		return undefined;
	}
	return {
		name,
		path,
		...(typeof kind === "string" ? { kind } : {}),
		...(typeof entry === "string" ? { entry } : {}),
		dependsOn: Array.isArray(dependsOn)
			? dependsOn.filter((item): item is string => typeof item === "string")
			: [],
	};
}

function denyRules(raw: unknown): NonNullable<ArchCheckOptions["deny"]> {
	return (Array.isArray(raw) ? raw : []).flatMap((item) => {
		const from = isRecord(item) ? field(item, "from") : undefined;
		const to = isRecord(item) ? field(item, "to") : undefined;
		return typeof from === "string" && typeof to === "string"
			? [{ from, to }]
			: [];
	});
}

function layerNames(raw: unknown): ReadonlyArray<string> {
	const names = isRecord(raw) ? field(raw, "names") : undefined;
	return isRecord(raw) && field(raw, "enabled") === true && Array.isArray(names)
		? names.filter((name): name is string => typeof name === "string")
		: [];
}

// A missing or unreadable config reads as no map, like a missing manifest.
async function readJson(
	ports: Ports,
	path: string,
): Promise<ReturnType<typeof parseJson> | undefined> {
	try {
		const loaded = await ports.fs.readText(path);
		return loaded.ok ? parseJson(loaded.value) : undefined;
	} catch {
		return undefined;
	}
}

async function readSetup(ports: Ports): Promise<ArchSetup | undefined> {
	const parsed = await readJson(ports, CONFIG_PATH);
	const root = parsed?.ok === true ? parsed.value : undefined;
	const architecture = isRecord(root) ? field(root, "architecture") : undefined;
	const raw = isRecord(architecture)
		? field(architecture, "modules")
		: undefined;
	if (!isRecord(architecture) || !Array.isArray(raw)) {
		return undefined;
	}
	const modules = raw.flatMap((item) => moduleNode(item) ?? []);
	if (modules.length === 0) {
		return undefined;
	}
	const profile = field(architecture, "profile");
	return {
		modules,
		options: {
			modules,
			layerDirs: layerNames(field(architecture, "layers")),
			deny: denyRules(field(architecture, "deny")),
			...(typeof profile === "string" ? { profile } : {}),
		},
	};
}

function refsOf(file: string, text: string): Array<ImportRef> {
	return extractLiteralSpecifiers(text).map((found) => ({
		from: file,
		to: found.spec,
		line: found.line,
	}));
}

async function existingRefs(
	ports: Ports,
	modules: ReadonlyArray<ModuleNode>,
	skip: ReadonlySet<string>,
): Promise<Array<ImportRef>> {
	const refs: Array<ImportRef> = [];
	let read = 0;
	for (const mod of modules) {
		const base = mod.path.endsWith("/**") ? mod.path.slice(0, -3) : mod.path;
		const listed = await ports.fs.glob("**/*.ts", base);
		for (const file of listed.ok ? listed.value : []) {
			if (skip.has(file) || isTestPath(file) || read >= MAX_GRAPH_FILES) {
				continue;
			}
			read += 1;
			const text = await ports.fs.readText(file);
			if (text.ok) {
				refs.push(...refsOf(file, text.value));
			}
		}
	}
	return refs;
}

// Cycles the call's own edges close: those the whole graph reports that the
// existing files alone did not.
async function newCycles(
	ports: Ports,
	ctx: CheckContext,
	setup: ArchSetup,
	proposed: ReadonlyArray<ImportRef>,
	files: ReadonlySet<string>,
): Promise<Array<Finding>> {
	const existing = await existingRefs(ports, setup.modules, files);
	const cycles = (found: ReadonlyArray<Finding>): Array<Finding> =>
		found.filter((finding) => finding.ruleId === "core/arch-no-cycles");
	const before = new Set(
		cycles(await checkArch(ctx, existing, setup.options)).map(
			(finding) => finding.message,
		),
	);
	return cycles(
		await checkArch(ctx, [...existing, ...proposed], setup.options),
	).filter((finding) => !before.has(finding.message));
}

// The findings of one L1 architecture rule over the call's proposed files.
export async function archLiveFindings(
	ports: Ports,
	ctx: CheckContext,
	binding: RuleBinding,
	ruleId: string,
): Promise<Array<Finding>> {
	const judged = effectiveFiles(ctx, binding.scopeGlobs).filter(
		(file) =>
			file.proposed &&
			file.whole &&
			file.text !== undefined &&
			isTsFile(file.path) &&
			!isTestPath(file.path),
	);
	const setup = judged.length === 0 ? undefined : await readSetup(ports);
	if (setup === undefined) {
		return [];
	}
	const proposed = judged.flatMap((file) => refsOf(file.path, file.text ?? ""));
	const found = await checkArch(ctx, proposed, setup.options);
	for (const file of judged) {
		if (assignModule(setup.modules, file.path) === undefined) {
			found.push(
				mappedFinding(
					file.path,
					1,
					`source file ${file.path} sits outside every architecture module`,
				),
			);
		}
	}
	if (ruleId === "core/arch-no-cycles" && proposed.length > 0) {
		found.push(
			...(await newCycles(
				ports,
				ctx,
				setup,
				proposed,
				new Set(judged.map((file) => file.path)),
			)),
		);
	}
	const seen = new Set<string>();
	return found.filter((finding) => {
		const key = `${finding.ruleId}|${finding.path ?? ""}|${finding.message}`;
		const fresh = finding.ruleId === ruleId && !seen.has(key);
		seen.add(key);
		return fresh;
	});
}
