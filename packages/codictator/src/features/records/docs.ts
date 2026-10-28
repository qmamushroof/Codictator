// SPEC §4.9.1–§4.9.2: doc classes and every decidable doc check. All
// functions are pure over caller-supplied trees: the evaluation path passes
// the staged file list plus the contents the layer already read, so this
// module never touches the filesystem (SPEC §3.3, §10.3 item 3).
import { globMatch, normalizeText } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";

export type DocClass = "record" | "managed" | "router" | "leaf" | "single";

export interface DocFile {
	readonly path: string;
	readonly text: string;
}

export interface DocLimits {
	readonly maxBytes: number;
	readonly maxLines: number;
	readonly maxH2: number;
	readonly maxFilesPerFolder: number;
	readonly maxSentenceWords: number;
	readonly maxParagraphSentences: number;
}

// SPEC §5.10: the tunable defaults the limits ship with.
export const DEFAULT_DOC_LIMITS: DocLimits = {
	maxBytes: 40000,
	maxLines: 500,
	maxH2: 15,
	maxFilesPerFolder: 40,
	maxSentenceWords: 40,
	maxParagraphSentences: 6,
};

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

const LEAF_NAME_PATTERN = /^\d{2}(-\d{2})?-[A-Z0-9]+(-[A-Z0-9]+)*\.md$/;

const ABBREVIATIONS: ReadonlySet<string> = new Set([
	"e.g.",
	"i.e.",
	"etc.",
	"vs.",
	"cf.",
]);

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

export interface RouterLeaf {
	readonly name: string;
	readonly text: string;
}

export interface RouterTree {
	readonly routerPath: string;
	readonly routerText: string;
	readonly leaves: ReadonlyArray<RouterLeaf>;
}

function isTableRow(line: string): boolean {
	return line.trimStart().startsWith("|");
}

function isHeading(line: string): boolean {
	return /^#{1,6}\s/.test(line.trimStart());
}

function isLinkOnlyLine(line: string): boolean {
	const stripped = line.trim();
	if (stripped === "") {
		return false;
	}
	const withoutLinks = stripped.replace(/!?\[.*?\]\(.*?\)/g, "").trim();
	return withoutLinks.replace(/[*_~`|>\s-]/g, "") === "";
}

function routerLinkTargets(routerText: string): Array<string> {
	const targets: Array<string> = [];
	const pattern = /\[[^\]]*\]\(([^)#\s]+\.md)(?:#[^)\s]*)?\)/g;
	let match = pattern.exec(routerText);
	while (match !== null) {
		targets.push(match[1] ?? "");
		match = pattern.exec(routerText);
	}
	return targets;
}

function expectedNavLine(
	routerPath: string,
	previous: string | undefined,
	next: string | undefined,
): string {
	const routerName = routerPath.split("/").pop() ?? routerPath;
	const prev =
		previous === undefined ? "(first)" : `[◀ ${previous}](${previous})`;
	const following = next === undefined ? "(last)" : `[${next} ▶](${next})`;
	return `**${prev}** · [${routerName}](${routerPath}) · **${following}**`;
}

function firstContentLine(text: string): string {
	for (const raw of normalizeText(text).split("\n")) {
		const line = raw.trim();
		if (line !== "" && !isHeading(raw)) {
			return raw;
		}
	}
	return "";
}

function navSlots(line: string): Array<string> {
	const slots: Array<string> = [];
	const pattern =
		/\[[^\]]*\]\(([^)#\s]+)(?:#[^)\s]*)?\)|\(\s*(first|last)\s*\)/g;
	let match = pattern.exec(line);
	while (match !== null) {
		const target = match[1];
		const marker = match[2];
		if (target !== undefined) {
			slots.push(target.split("/").pop() ?? target);
		} else if (marker !== undefined) {
			slots.push(`(${marker})`);
		}
		match = pattern.exec(line);
	}
	return slots;
}

// SPEC §4.9.2 core/doc-router-leaf: the router holds only an H1, an
// optional one-line intro and tables; every leaf links exactly once in
// file-name order; every leaf carries the matching nav line.
export function checkDocRouterLeaf(tree: RouterTree): Array<Finding> {
	const findings: Array<Finding> = [];
	const routerName = tree.routerPath.split("/").pop() ?? tree.routerPath;
	const lines = normalizeText(tree.routerText).split("\n");
	const prose = lines.filter(
		(line) =>
			line.trim() !== "" &&
			!isHeading(line) &&
			!isTableRow(line) &&
			!isLinkOnlyLine(line),
	);
	if (prose.length > 1) {
		findings.push({
			ruleId: "core/doc-router-leaf",
			path: tree.routerPath,
			message: `router holds prose beyond its one-line intro: ${routerName}`,
			remediation: `Keep only the H1, a single intro line and tables in ${tree.routerPath}; move the paragraph to a leaf.`,
		});
	}
	const leafNames = tree.leaves.map((leaf) => leaf.name).sort();
	for (const leaf of tree.leaves) {
		if (!LEAF_NAME_PATTERN.test(leaf.name)) {
			findings.push({
				ruleId: "core/doc-router-leaf",
				path: `${tree.routerPath}`,
				message: `leaf name outside the router pattern: ${leaf.name}`,
				remediation: `Rename the leaf to NN-NAME.md or NN-MM-NAME.md with uppercase segments, e.g. 04-09-RECORDS.md.`,
			});
		}
	}
	const linked = routerLinkTargets(tree.routerText).filter((target) =>
		target.split("/").pop(),
	);
	const counts = new Map<string, number>();
	for (const target of linked) {
		const base = target.split("/").pop() ?? target;
		counts.set(base, (counts.get(base) ?? 0) + 1);
	}
	for (const name of leafNames) {
		const seen = counts.get(name) ?? 0;
		if (seen === 0) {
			findings.push({
				ruleId: "core/doc-router-leaf",
				path: tree.routerPath,
				message: `leaf missing from router: ${name}`,
				remediation: `Link [${name}](${name}) exactly once in ${tree.routerPath}, in file-name order.`,
			});
		} else if (seen > 1) {
			findings.push({
				ruleId: "core/doc-router-leaf",
				path: tree.routerPath,
				message: `leaf linked ${seen} times in router: ${name}`,
				remediation: `Link [${name}](${name}) exactly once in ${tree.routerPath}, in file-name order.`,
			});
		}
	}
	const ordered = linked
		.map((target) => target.split("/").pop() ?? target)
		.filter((base) => leafNames.includes(base));
	const expectedOrder = leafNames.filter((name) => ordered.includes(name));
	if (ordered.join("\n") !== expectedOrder.join("\n")) {
		findings.push({
			ruleId: "core/doc-router-leaf",
			path: tree.routerPath,
			message: `router leaf links out of file-name order in ${routerName}`,
			remediation: `Order the leaf links in ${tree.routerPath} as: ${expectedOrder.join(", ")}.`,
		});
	}
	leafNames.forEach((name, index) => {
		const leaf = tree.leaves.find((entry) => entry.name === name);
		if (leaf === undefined) {
			return;
		}
		const previous = index === 0 ? undefined : leafNames[index - 1];
		const next =
			index === leafNames.length - 1 ? undefined : leafNames[index + 1];
		const navLine = firstContentLine(leaf.text);
		// Slots are previous (link or "(first)"), the router link, next
		// (link or "(last)"), matching router order.
		const slots = navSlots(navLine);
		const routerBase = tree.routerPath.split("/").pop() ?? tree.routerPath;
		const expected = [previous ?? "(first)", routerBase, next ?? "(last)"];
		const actual = slots.slice(0, 3);
		if (
			actual.length < 3 ||
			actual[0] !== expected[0] ||
			actual[1] !== expected[1] ||
			actual[2] !== expected[2]
		) {
			findings.push({
				ruleId: "core/doc-router-leaf",
				path: tree.routerPath,
				message: `nav line of ${name} points at the wrong neighbours`,
				remediation: expectedNavLine(tree.routerPath, previous, next),
			});
		}
	});
	return findings;
}

// SPEC §4.9.2 core/doc-size: bytes and lines per file.
export function checkDocSize(
	files: ReadonlyArray<DocFile>,
	limits: DocLimits = DEFAULT_DOC_LIMITS,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const file of files) {
		const text = normalizeText(file.text);
		const bytes = new TextEncoder().encode(text).length;
		const lines = text === "" ? 0 : text.split("\n").length;
		if (bytes > limits.maxBytes) {
			findings.push({
				ruleId: "core/doc-size",
				path: file.path,
				message: `doc over the byte limit: ${file.path} holds ${bytes} bytes, limit ${limits.maxBytes}`,
				remediation: `Split ${file.path} under ${limits.maxBytes} bytes; one fact lives in one leaf (SPEC §1.4).`,
			});
		}
		if (lines > limits.maxLines) {
			findings.push({
				ruleId: "core/doc-size",
				path: file.path,
				message: `doc over the line limit: ${file.path} holds ${lines} lines, limit ${limits.maxLines}`,
				remediation: `Split ${file.path} under ${limits.maxLines} lines; one fact lives in one leaf (SPEC §1.4).`,
			});
		}
	}
	return findings;
}

function stripFences(text: string): string {
	return normalizeText(text)
		.split("\n")
		.filter((_, index, all) => {
			let fenced = false;
			for (let scan = 0; scan < index; scan += 1) {
				if (all[scan]?.trimStart().startsWith("```") === true) {
					fenced = !fenced;
				}
			}
			const line = all[index] ?? "";
			return !fenced && !line.trimStart().startsWith("```");
		})
		.join("\n");
}

// SPEC §4.9.2 core/doc-breadth: ## headings per file, files per folder.
export function checkDocBreadth(
	files: ReadonlyArray<DocFile>,
	filesPerFolder: Readonly<Record<string, number>> = {},
	limits: DocLimits = DEFAULT_DOC_LIMITS,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const file of files) {
		let headings = 0;
		for (const line of stripFences(file.text).split("\n")) {
			if (/^##(?!#)\s/.test(line.trimStart())) {
				headings += 1;
			}
		}
		if (headings > limits.maxH2) {
			findings.push({
				ruleId: "core/doc-breadth",
				path: file.path,
				message: `doc over the heading limit: ${file.path} holds ${headings} ## headings, limit ${limits.maxH2}`,
				remediation: `Split ${file.path} under ${limits.maxH2} ## headings; one fact lives in one leaf (SPEC §1.4).`,
			});
		}
	}
	for (const [folder, count] of Object.entries(filesPerFolder)) {
		if (count > limits.maxFilesPerFolder) {
			findings.push({
				ruleId: "core/doc-breadth",
				path: folder,
				message: `folder over the file limit: ${folder} holds ${count} markdown files, limit ${limits.maxFilesPerFolder}`,
				remediation: `Split ${folder} under ${limits.maxFilesPerFolder} markdown files.`,
			});
		}
	}
	return findings;
}

function wordsOf(sentence: string): Array<string> {
	return sentence
		.replace(/`[^`]*`/g, "X")
		.split(/\s+/)
		.filter((token) => /[A-Za-z0-9]/.test(token));
}

// SPEC §4.9.2 core/doc-density: tables, code, headings and link-only lines
// are excluded; each list item is one paragraph. A sentence ends at . ! ?
// followed by whitespace and then anything but a lowercase letter, or at the
// paragraph end; never inside a code span or after the listed abbreviations.
export function splitSentences(paragraph: string): Array<string> {
	const masked = paragraph.replace(/`[^`]*`/g, (span) =>
		"X".repeat(span.length),
	);
	const sentences: Array<string> = [];
	let start = 0;
	const flush = (end: number): void => {
		const piece = paragraph.slice(start, end).trim();
		if (piece !== "") {
			sentences.push(piece);
		}
		start = end;
	};
	for (let index = 0; index < masked.length; index += 1) {
		const char = masked[index] ?? "";
		if (char !== "." && char !== "!" && char !== "?") {
			continue;
		}
		const rest = masked.slice(index + 1);
		const endOfParagraph = rest.trim() === "";
		const afterSpace = /^[ \t]+([^a-z])/.exec(rest);
		if (!endOfParagraph && afterSpace === null) {
			continue;
		}
		const before =
			masked
				.slice(0, index + 1)
				.split(/\s+/)
				.pop() ?? "";
		if (ABBREVIATIONS.has(before.toLowerCase())) {
			continue;
		}
		flush(index + 1);
	}
	flush(paragraph.length);
	return sentences;
}

function densityParagraphs(text: string): Array<string> {
	const paragraphs: Array<string> = [];
	let current: Array<string> = [];
	const flush = (): void => {
		if (current.length > 0) {
			paragraphs.push(current.join(" "));
			current = [];
		}
	};
	for (const raw of stripFences(text).split("\n")) {
		const line = raw.trim();
		if (line === "" || isHeading(raw) || isTableRow(raw)) {
			flush();
			continue;
		}
		const noSpans = raw.replace(/`[^`]*`/g, "X").trim();
		if (noSpans !== "" && isLinkOnlyLine(raw)) {
			continue;
		}
		if (/^\s*([-*+]|\d+[.)])\s+/.test(raw)) {
			flush();
			paragraphs.push(raw.trim());
			continue;
		}
		current.push(raw.trim());
	}
	flush();
	return paragraphs.filter((paragraph) => paragraph !== "");
}

export function checkDocDensity(
	files: ReadonlyArray<DocFile>,
	limits: DocLimits = DEFAULT_DOC_LIMITS,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const file of files) {
		for (const paragraph of densityParagraphs(file.text)) {
			const sentences = splitSentences(paragraph);
			if (sentences.length > limits.maxParagraphSentences) {
				findings.push({
					ruleId: "core/doc-density",
					path: file.path,
					message: `paragraph over the sentence limit in ${file.path}: ${sentences.length} sentences, limit ${limits.maxParagraphSentences}`,
					remediation: `Split the paragraph in ${file.path} under ${limits.maxParagraphSentences} sentences.`,
				});
			}
			for (const sentence of sentences) {
				const count = wordsOf(sentence).length;
				if (count > limits.maxSentenceWords) {
					findings.push({
						ruleId: "core/doc-density",
						path: file.path,
						message: `sentence over the word limit in ${file.path}: ${count} words, limit ${limits.maxSentenceWords}`,
						remediation: `Split the sentence in ${file.path} under ${limits.maxSentenceWords} words.`,
					});
				}
			}
		}
	}
	return findings;
}

export function githubSlug(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/`[^`]*`/g, "")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");
}

function editDistance(a: string, b: string): number {
	const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i += 1) {
		let diagonal = previous[0] ?? 0;
		previous[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const above = previous[j] ?? 0;
			const left = previous[j - 1] ?? 0;
			previous[j] =
				a[i - 1] === b[j - 1] ? diagonal : Math.min(diagonal, above, left) + 1;
			diagonal = above;
		}
	}
	return previous[b.length] ?? 0;
}

function nearestSlug(wanted: string, slugs: ReadonlySet<string>): string {
	return [...slugs]
		.sort(
			(a, b) =>
				editDistance(wanted, a) - editDistance(wanted, b) || (a < b ? -1 : 1),
		)
		.slice(0, 3)
		.join(", ");
}

function headingSlugs(text: string): Set<string> {
	const slugs = new Set<string>();
	for (const line of stripFences(text).split("\n")) {
		const match = /^#{1,6}\s+(.+?)\s*$/.exec(line.trim());
		if (match !== null) {
			slugs.add(githubSlug(match[1] ?? ""));
		}
	}
	return slugs;
}

export interface DocLink {
	readonly target: string;
	readonly anchor: string | undefined;
	readonly line: number;
}

function docLinks(text: string): Array<DocLink> {
	const links: Array<DocLink> = [];
	normalizeText(text)
		.split("\n")
		.forEach((line, index) => {
			const pattern = /\[.*?\]\(([^)\s]+)\)/g;
			let match = pattern.exec(line);
			while (match !== null) {
				const raw = match[1] ?? "";
				if (!/^(https?|mailto):/.test(raw)) {
					const hash = raw.indexOf("#");
					links.push({
						target: hash < 0 ? raw : raw.slice(0, hash),
						anchor: hash < 0 ? undefined : raw.slice(hash + 1),
						line: index + 1,
					});
				}
				match = pattern.exec(line);
			}
		});
	return links;
}

function resolveRelative(from: string, target: string): string {
	if (target === "") {
		return from;
	}
	const parts = from.split("/").slice(0, -1);
	for (const piece of target.split("/")) {
		if (piece === "." || piece === "") {
			continue;
		}
		if (piece === "..") {
			parts.pop();
			continue;
		}
		parts.push(piece);
	}
	return parts.join("/");
}

// SPEC §4.9.2 core/doc-links-valid: every relative link resolves; every
// anchor matches a GitHub-style heading slug in the target.
export function checkDocLinksValid(
	files: ReadonlyArray<DocFile>,
	known: ReadonlyMap<string, string>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const file of files) {
		for (const link of docLinks(file.text)) {
			const resolved = resolveRelative(file.path, link.target);
			const targetText = link.target === "" ? file.text : known.get(resolved);
			if (targetText === undefined) {
				findings.push({
					ruleId: "core/doc-links-valid",
					path: file.path,
					line: link.line,
					message: `link target missing: ${link.target || "(self)"} from ${file.path} resolves to ${resolved}`,
					remediation: `Fix the link in ${file.path} line ${link.line} so it resolves to an existing file.`,
				});
				continue;
			}
			if (link.anchor !== undefined) {
				const slugs = headingSlugs(targetText);
				if (!slugs.has(link.anchor.toLowerCase())) {
					const nearest = nearestSlug(link.anchor.toLowerCase(), slugs);
					findings.push({
						ruleId: "core/doc-links-valid",
						path: file.path,
						line: link.line,
						message: `link anchor missing: #${link.anchor} matches no heading in ${resolved}`,
						remediation: `Change #${link.anchor} to #${nearest.split(", ")[0] ?? ""} in ${file.path} line ${link.line}${nearest === "" ? "" : ` (nearest: ${nearest})`}.`,
					});
				}
			}
		}
	}
	return findings;
}

const CHANGELOG_HEADING =
	/^(change ?log|history|revisions?|what's new|updates?)$/i;
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

const CORPUS_COUNT =
	/\b(this|the)\s+(corpus|repository|repos|docs?|spec|prd|folder)\s+(has|contains|holds|consists of)\s+\d+/i;

// SPEC §4.9.2 core/doc-no-corpus-counts: counts rot, so sentences stating
// them are banned.
export function checkDocNoCorpusCounts(
	files: ReadonlyArray<DocFile>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const file of files) {
		for (const paragraph of densityParagraphs(file.text)) {
			for (const sentence of splitSentences(paragraph)) {
				if (CORPUS_COUNT.test(sentence)) {
					findings.push({
						ruleId: "core/doc-no-corpus-counts",
						path: file.path,
						message: `corpus count in ${file.path}: "${sentence.slice(0, 80)}"`,
						remediation: `Remove the hardcoded count from ${file.path}; point at the source of truth instead.`,
					});
				}
			}
		}
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
