// SPEC §4.9.1–§4.9.2: doc classification, placement, changelog and
// single-owner checks plus the evaluation-path entry. Shape checks live in
// docs-structure.ts, prose checks in docs-prose.ts. All functions are pure
// over caller-supplied trees: the evaluation path passes the staged file
// list plus the contents the layer already read (SPEC §3.3, §10.3 item 3).
import { globMatch, normalizeText } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";
import {
	checkDocDensity,
	checkDocLinksValid,
	checkDocNoCorpusCounts,
	densityParagraphs,
	splitSentences,
	wordsOf,
} from "./docs-prose.ts";
import type { DocFile, RouterLeaf } from "./docs-structure.ts";
import {
	checkDocBreadth,
	checkDocRouterLeaf,
	checkDocSize,
	isTableRow,
} from "./docs-structure.ts";

export type DocClass = "record" | "managed" | "router" | "leaf" | "single";

const ROOT_DOCS: ReadonlySet<string> = new Set([
	"README.md",
	"AGENTS.md",
	"CLAUDE.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md",
	"SECURITY.md",
	"CODE_OF_CONDUCT.md",
]);

const HARNESS_DIRS = [
	".agents",
	".claude",
	".github",
	".cursor",
	".gemini",
	".opencode",
	".muse",
] as const;

// SPEC §4.9.1: first match wins. knownDirs holds the repo's directory set so
// a router is recognised without filesystem access; managed holds the
// guardrail manifest paths (§4.14.1).
export function classifyDoc(
	path: string,
	knownDirs: ReadonlySet<string> = new Set(),
	managed: ReadonlySet<string> = new Set(),
): DocClass {
	if (managed.has(path)) {
		return "managed";
	}
	if (path.startsWith("docs/HISTORY/") || path.startsWith("docs/BUGS/")) {
		return "record";
	}
	const routerMatch = /^docs\/([^/]+)\.md$/.exec(path);
	if (routerMatch !== null) {
		const name = routerMatch[1] ?? "";
		return knownDirs.has(`docs/${name}`) ? "router" : "single";
	}
	if (/^docs\/[^/]+\/.+/.test(path)) {
		return "leaf";
	}
	return "single";
}

function placementFinding(path: string, reason: string): Finding {
	return {
		ruleId: "core/doc-placement",
		path,
		message: `markdown file outside its placed locations: ${path} (${reason})`,
		remediation: `Move ${path} to docs/, docs/<NAME>/, packages/*/README.md or an allowed glob, or add an allowedGlobs entry.`,
	};
}

// SPEC §4.9.2 core/doc-placement: the never-files docs/HISTORY.md and
// docs/BUGS.md are rejected even though docs/*.md is otherwise allowed.
export function checkDocPlacement(
	paths: ReadonlyArray<string>,
	allowedGlobs: ReadonlyArray<string> = [],
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const path of paths) {
		if (!path.endsWith(".md")) {
			continue;
		}
		if (path === "docs/HISTORY.md" || path === "docs/BUGS.md") {
			findings.push(
				placementFinding(path, "record folders have no top-level file"),
			);
			continue;
		}
		if (!path.includes("/") && ROOT_DOCS.has(path)) {
			continue;
		}
		if (/^docs\/[^/]+\.md$/.test(path) || /^docs\/[^/]+\/.+/.test(path)) {
			continue;
		}
		if (/^packages\/[^/]+\/README\.md$/.test(path)) {
			continue;
		}
		if (
			HARNESS_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`)) ||
			path.startsWith(".codictator/")
		) {
			continue;
		}
		if (allowedGlobs.some((glob) => globMatch(glob, path))) {
			continue;
		}
		findings.push(placementFinding(path, "outside its allowed locations"));
	}
	return findings;
}

// SPEC §4.9.2 core/doc-one-level: no folder below docs/<NAME>/.
export function checkDocOneLevel(paths: ReadonlyArray<string>): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const path of paths) {
		if (!path.endsWith(".md")) {
			continue;
		}
		const match = /^docs\/([^/]+)\/([^/]+)\//.exec(path);
		if (match === null) {
			continue;
		}
		const folder = match[1] ?? "";
		if (folder === "HISTORY" || folder === "BUGS") {
			continue;
		}
		findings.push({
			ruleId: "core/doc-one-level",
			path,
			message: `doc nested below docs/${folder}/: ${path}`,
			remediation: `Move ${path} directly under docs/${folder}/; docs/<NAME>/ takes no subfolders.`,
		});
	}
	return findings;
}

// \x27 keeps the apostrophe out of the literal: the pack lexer blanks
// strings without regex awareness, so a quote char would hide later code.
const CHANGELOG_HEADING =
	/^(change ?log|history|revisions?|what\x27s new|updates?)$/i;
const CHANGELOG_LINE =
	/^[-*]?\s*(updated|changed|added|revised|amended)( on)?\s+\d{4}-\d{2}-\d{2}/i;

// SPEC §4.9.2 core/doc-no-inline-changelog: the per-doc changelog lives in
// the history entry (Docs field), never inline.
export function checkDocNoInlineChangelog(
	files: ReadonlyArray<DocFile>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const file of files) {
		normalizeText(file.text)
			.split("\n")
			.forEach((line, index) => {
				const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line.trim());
				if (heading !== null && CHANGELOG_HEADING.test(heading[1] ?? "")) {
					findings.push({
						ruleId: "core/doc-no-inline-changelog",
						path: file.path,
						line: index + 1,
						message: `inline changelog heading in ${file.path} line ${index + 1}`,
						remediation: `Remove the changelog section from ${file.path}; record the change in the history entry Docs field.`,
					});
					return;
				}
				if (!isTableRow(line) && CHANGELOG_LINE.test(line.trim())) {
					findings.push({
						ruleId: "core/doc-no-inline-changelog",
						path: file.path,
						line: index + 1,
						message: `inline changelog line in ${file.path} line ${index + 1}`,
						remediation: `Remove the dated change line from ${file.path}; record the change in the history entry Docs field.`,
					});
				}
			});
	}
	return findings;
}

function normaliseSentence(sentence: string): string {
	return sentence.replace(/\s+/g, " ").trim().toLowerCase();
}

// SPEC §4.9.2 core/doc-single-owner: no sentence of twelve or more words
// repeats across two non-record docs. Record docs hold generated history,
// so they are exempt both as sources and as carriers.
export function checkDocSingleOwner(
	files: ReadonlyArray<DocFile>,
): Array<Finding> {
	const seen = new Map<string, string>();
	const findings: Array<Finding> = [];
	for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
		for (const paragraph of densityParagraphs(file.text)) {
			for (const sentence of splitSentences(paragraph)) {
				if (wordsOf(sentence).length < 12) {
					continue;
				}
				const key = normaliseSentence(sentence);
				const owner = seen.get(key);
				if (owner === undefined) {
					seen.set(key, file.path);
				} else if (owner !== file.path) {
					findings.push({
						ruleId: "core/doc-single-owner",
						path: file.path,
						message: `sentence of twelve or more words repeats ${owner} in ${file.path}`,
						remediation: `Keep the fact in ${owner} and link to it from ${file.path} (SPEC §1.4: one fact, one owner).`,
					});
				}
			}
		}
	}
	return findings;
}

// The evaluation-path entry: path-decidable checks always run; content
// checks run on the supplied tree, with routers inferred from the union of
// staged paths and supplied contents.
export function checkDocs(
	_ctx: CheckContext,
	paths: ReadonlyArray<string>,
	contents: Readonly<Record<string, string>> = {},
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [
		...checkDocPlacement(paths),
		...checkDocOneLevel(paths),
	];
	const texts = new Map<string, string>(Object.entries(contents));
	if (texts.size === 0) {
		return Promise.resolve(findings);
	}
	const knownDirs = new Set<string>();
	for (const path of [...paths, ...texts.keys()]) {
		const pieces = path.split("/");
		for (let depth = 1; depth < pieces.length; depth += 1) {
			knownDirs.add(pieces.slice(0, depth).join("/"));
		}
	}
	const byClass = new Map<string, DocClass>();
	for (const path of texts.keys()) {
		byClass.set(path, classifyDoc(path, knownDirs));
	}
	const routers = [...texts.keys()].filter(
		(path) => byClass.get(path) === "router",
	);
	for (const routerPath of routers) {
		const prefix = routerPath.replace(/\.md$/, "/");
		const leaves: Array<RouterLeaf> = [...texts.entries()]
			.filter(([path]) => path.startsWith(prefix))
			.map(([path, text]) => ({
				name: path.slice(prefix.length),
				text,
			}))
			.filter((leaf) => !leaf.name.includes("/"));
		findings.push(
			...checkDocRouterLeaf({
				routerPath,
				routerText: texts.get(routerPath) ?? "",
				leaves,
			}),
		);
	}
	const known = new Map<string, string>(texts.entries());
	const leafFiles: Array<DocFile> = [];
	const singleFiles: Array<DocFile> = [];
	for (const [path, text] of texts.entries()) {
		const kind = byClass.get(path);
		if (kind === "leaf") {
			leafFiles.push({ path, text });
		} else if (kind === "single") {
			singleFiles.push({ path, text });
		}
	}
	for (const file of [...leafFiles, ...singleFiles]) {
		findings.push(
			...checkDocSize([file]),
			...checkDocBreadth([file]),
			...checkDocDensity([file]),
			...checkDocLinksValid([file], known),
			...checkDocNoInlineChangelog([file]),
			...checkDocNoCorpusCounts([file]),
		);
	}
	findings.push(
		...checkDocSingleOwner([...leafFiles, ...singleFiles]),
		...checkDocSize(
			[...texts.entries()]
				.filter(([path]) => byClass.get(path) === "record")
				.map(([path, text]) => ({ path, text })),
		),
	);
	return Promise.resolve(findings);
}
