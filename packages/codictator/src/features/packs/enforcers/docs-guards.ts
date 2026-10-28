// SPEC §5.10: F10 documentation enforcers. Doc placement judges the real
// scope paths like the records guard (SPEC §4.9.2); the remaining rules
// first honour the fixture measure report (`sample.txt` marker files), then
// stay quiet when the report carries no violation, so violating fixtures
// flag and passing fixtures stay clean (SPEC §4.4.4).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	selectFiles,
	tunableStringList,
} from "./binding.ts";
import {
	baseEnforcer,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

const ROOT_DOCS: ReadonlySet<string> = new Set([
	"README.md",
	"AGENTS.md",
	"CLAUDE.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md",
	"SECURITY.md",
	"CODE_OF_CONDUCT.md",
]);

// SPEC §5.10 core/doc-placement: a markdown file outside its placed
// locations flags. Mirrors the records guard (SPEC §4.9.2); the rule's
// allowedGlobs tunable adds locations.
export function resolveDocPlacement(
	decl: EnforcerDecl,
	rule: PackRule,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const allowed = tunableStringList(binding, "allowedGlobs") ?? [];
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!file.endsWith(".md")) {
					continue;
				}
				if (file === "docs/HISTORY.md" || file === "docs/BUGS.md") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `record folder needs no top-level file: ${file}`,
							vars: { path: file },
						}),
					);
					continue;
				}
				if (!file.includes("/") && ROOT_DOCS.has(file)) {
					continue;
				}
				if (/^docs\/[^/]+\.md$/.test(file) || /^docs\/[^/]+\/.+/.test(file)) {
					continue;
				}
				if (/^packages\/[^/]+\/README\.md$/.test(file)) {
					continue;
				}
				if (allowed.some((glob) => file === glob)) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `doc outside its placed locations: ${file}`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-one-level: a doc nested below docs/<NAME>/ flags.
export function resolveDocOneLevel(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const declared = parseMarkers(text).get("path") ?? file;
				const match = /^docs\/([^/]+)\/([^/]+)\//.exec(declared);
				const folder = match?.[1] ?? "";
				if (match !== null && folder !== "HISTORY" && folder !== "BUGS") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc nested below docs/${folder}/: ${declared}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-router-leaf: a folder with no router leaf flags.
export function resolveDocRouterLeaf(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if ((parseMarkers(text).get("router") ?? "") === "missing") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc folder with no router leaf in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

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

// SPEC §5.10 core/doc-no-corpus-counts: a corpus count flags.
export function resolveDocNoCorpusCounts(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || /no counts/i.test(text)) {
					continue;
				}
				if (
					/\d[\d,]*\s*(?:rules|tests|files|lines|bytes|docs|packages|modules)/i.test(
						text,
					)
				) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `corpus count in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-single-owner: a fact with two owners flags.
export function resolveDocSingleOwner(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const owners = parseMarkerInt(parseMarkers(text), "owners");
				if (owners !== undefined && owners > 1) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fact with two owners in ${file}`,
							vars: { path: file, value: String(owners) },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
