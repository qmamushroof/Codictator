// SPEC §5.6 core/dead-code: no unused exports or members. The pack
// measure is an exported name in a non-entry file with no importer.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { findingFor, type RuleBinding, selectFiles } from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import {
	checkEnforcer,
	exportedNamesOf,
	fileImportsTarget,
	isEntryFile,
	isMarkerFile,
	isTsFile,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

async function loadScopeTexts(
	ports: Ports,
	binding: RuleBinding,
	files: ReadonlyArray<string>,
	findings: Array<Finding>,
): Promise<Map<string, string>> {
	const texts = new Map<string, string>();
	for (const file of files) {
		const text = await loadScopeText(ports, binding, file, findings);
		if (text !== undefined) {
			texts.set(file, text);
		}
	}
	return texts;
}

function markerDeadCode(
	binding: RuleBinding,
	file: string,
	text: string,
): Array<Finding> {
	const markers = parseMarkers(text);
	const importers = parseMarkerInt(markers, "importers") ?? 1;
	const exported = markers.get("exported") ?? "export";
	if (importers !== 0) {
		return [];
	}
	return [
		findingFor(binding, {
			path: file,
			line: 1,
			message: `unused export ${exported} in ${file}`,
			vars: { path: file, line: "1", value: exported },
		}),
	];
}

function fileIsImported(
	texts: ReadonlyMap<string, string>,
	file: string,
): boolean {
	for (const [other, otherText] of texts.entries()) {
		if (
			other !== file &&
			isTsFile(other) &&
			fileImportsTarget(otherText, file)
		) {
			return true;
		}
	}
	return false;
}

function tsDeadCode(
	binding: RuleBinding,
	file: string,
	text: string,
	texts: ReadonlyMap<string, string>,
): Array<Finding> {
	if (!isTsFile(file) || isEntryFile(file)) {
		return [];
	}
	const exported = exportedNamesOf(blankCode(text));
	if (exported.length === 0 || fileIsImported(texts, file)) {
		return [];
	}
	return exported.map((name) =>
		findingFor(binding, {
			path: file,
			line: 1,
			message: `unused export ${name} in ${file}`,
			vars: { path: file, line: "1", value: name },
		}),
	);
}

async function deadCodeCheck(
	ports: Ports,
	binding: RuleBinding,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	const files = selectFiles(ctx.scope.files, binding.scopeGlobs);
	const texts = await loadScopeTexts(ports, binding, files, findings);
	for (const file of files) {
		const text = texts.get(file);
		if (text === undefined) {
			continue;
		}
		if (isMarkerFile(file)) {
			findings.push(...markerDeadCode(binding, file, text));
			continue;
		}
		findings.push(...tsDeadCode(binding, file, text, texts));
	}
	return findings;
}

// SPEC §5.6 core/dead-code: no unused exports or members. The pack
// measure is an exported name in a non-entry file with no importer.
export function resolveDeadCode(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return checkEnforcer(decl, rule, (binding, ctx) =>
		deadCodeCheck(ports, binding, ctx),
	);
}
