// SPEC §5.10 F10 documentation content measures: breadth, density,
// link validity and inline changelogs. Split from the doc-structure guards
// (docs-guards) by responsibility; the fixture measure reports drive both.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import { isDocScopeFile } from "./docs-guards.ts";
import {
	baseEnforcer,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.10 core/doc-breadth: headings or folder counts over the tunable
// limits flag.
export function resolveDocBreadth(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxH2 = limitOf(binding, "maxH2", 15);
	const maxFiles = limitOf(binding, "maxFilesPerFolder", 40);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				const headings = parseMarkerInt(markers, "h2");
				const folderFiles = parseMarkerInt(markers, "files-in-folder");
				if (
					(headings !== undefined && headings > maxH2) ||
					(folderFiles !== undefined && folderFiles > maxFiles)
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc over the breadth limit in ${file}`,
							vars: {
								path: file,
								limit: `${String(maxH2)}/${String(maxFiles)}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-density: long sentences or paragraphs flag.
export function resolveDocDensity(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxWords = limitOf(binding, "maxSentenceWords", 40);
	const maxSentences = limitOf(binding, "maxParagraphSentences", 6);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const markers = parseMarkers(text);
				const words = parseMarkerInt(markers, "sentence-words");
				const sentences = parseMarkerInt(markers, "paragraph-sentences");
				if (
					(words !== undefined && words > maxWords) ||
					(sentences !== undefined && sentences > maxSentences)
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc over the density limit in ${file}`,
							vars: {
								path: file,
								limit: `${String(maxWords)}/${String(maxSentences)}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-links-valid: a link that does not resolve flags.
export function resolveDocLinksValid(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if (/status:\s*404/.test(text)) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc link does not resolve in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-no-inline-changelog: an inline changelog flags.
export function resolveDocNoInlineChangelog(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !/##\s*changelog/i.test(text)) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `inline changelog in ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}
