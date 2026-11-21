// SPEC §5.10 F10 documentation content measures: breadth, density,
// link validity and inline changelogs. Split from the doc-structure guards
// (docs-guards) by responsibility; the fixture measure reports drive both.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor } from "./binding.ts";
import { isDocScopeFile } from "./docs-guards.ts";
import { docRule, liveChangelog, liveLinks } from "./docs-live.ts";
import { limitOf, parseMarkerInt, parseMarkers } from "./health-measures.ts";
import { scopeTextRule } from "./scope-text-rule.ts";

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
	return scopeTextRule(
		decl,
		rule,
		ports,
		(bound, file, text, findings) => {
			const markers = parseMarkers(text);
			const headings = parseMarkerInt(markers, "h2");
			const folderFiles = parseMarkerInt(markers, "files-in-folder");
			if (
				(headings !== undefined && headings > maxH2) ||
				(folderFiles !== undefined && folderFiles > maxFiles)
			) {
				findings.push(
					findingFor(bound, {
						path: file,
						message: `doc over the breadth limit in ${file}`,
						vars: {
							path: file,
							limit: `${String(maxH2)}/${String(maxFiles)}`,
						},
					}),
				);
			}
		},
		isDocScopeFile,
	);
}

// SPEC §5.10 core/doc-density: long sentences or paragraphs flag.
export function resolveDocDensity(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeTextRule(
		decl,
		rule,
		ports,
		(binding, file, text, findings) => {
			const maxWords = limitOf(binding, "maxSentenceWords", 40);
			const maxSentences = limitOf(binding, "maxParagraphSentences", 6);
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
		},
		isDocScopeFile,
	);
}

// SPEC §5.10 core/doc-links-valid: a link that does not resolve flags; a
// fixture report names it with a 404 status, a real doc is judged live.
export function resolveDocLinksValid(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return docRule(
		decl,
		rule,
		ports,
		(args, file, text) => {
			if (/status:\s*404/.test(text)) {
				args.findings.push(
					findingFor(args.binding, {
						path: file,
						message: `doc link does not resolve in ${file}`,
						vars: { path: file },
					}),
				);
			}
		},
		liveLinks,
	);
}

// SPEC §5.10 core/doc-no-inline-changelog: an inline changelog flags; a
// fixture report names a changelog section, a real doc is judged live.
export function resolveDocNoInlineChangelog(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return docRule(
		decl,
		rule,
		ports,
		(args, file, text) => {
			if (/##\s*changelog/i.test(text)) {
				args.findings.push(
					findingFor(args.binding, {
						path: file,
						message: `inline changelog in ${file}`,
						vars: { path: file },
					}),
				);
			}
		},
		liveChangelog,
	);
}
