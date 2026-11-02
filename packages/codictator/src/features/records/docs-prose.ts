// SPEC §4.9.2: doc prose checks — sentence splitting, density, link
// validity, corpus counts. All functions are pure over caller-supplied
// trees; this module never touches the filesystem (SPEC §3.3, §10.3 item 3).
import { normalizeText } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import type { DocFile, DocLimits } from "./docs-lines.ts";
import {
	isHeading,
	isLinkOnlyLine,
	isTableRow,
	stripFences,
} from "./docs-lines.ts";
import { DEFAULT_DOC_LIMITS } from "./docs-structure.ts";

const ABBREVIATIONS: ReadonlySet<string> = new Set([
	"e.g.",
	"i.e.",
	"etc.",
	"vs.",
	"cf.",
]);

// \x60 keeps literal backticks out of the span patterns: the pack lexer
// blanks template bodies without regex awareness, so a backtick char
// would hide later code.
export function wordsOf(sentence: string): Array<string> {
	return sentence
		.replace(/\x60[^\x60]*\x60/g, "X")
		.split(/\s+/)
		.filter((token) => /[A-Za-z0-9]/.test(token));
}

function shouldSplitAt(masked: string, index: number): boolean {
	const char = masked[index] ?? "";
	if (char !== "." && char !== "!" && char !== "?") {
		return false;
	}
	const rest = masked.slice(index + 1);
	if (rest.trim() !== "" && /^[ \t]+([^a-z])/.exec(rest) === null) {
		return false;
	}
	const before =
		masked
			.slice(0, index + 1)
			.split(/\s+/)
			.pop() ?? "";
	return !ABBREVIATIONS.has(before.toLowerCase());
}

// SPEC §4.9.2 core/doc-density: tables, code, headings and link-only lines
// are excluded; each list item is one paragraph. A sentence ends at . ! ?
// followed by whitespace and then anything but a lowercase letter, or at the
// paragraph end; never inside a code span or after the listed abbreviations.
export function splitSentences(paragraph: string): Array<string> {
	const masked = paragraph.replace(/\x60[^\x60]*\x60/g, (span) =>
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
		if (shouldSplitAt(masked, index)) {
			flush(index + 1);
		}
	}
	flush(paragraph.length);
	return sentences;
}

export function densityParagraphs(text: string): Array<string> {
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
		const noSpans = raw.replace(/\x60[^\x60]*\x60/g, "X").trim();
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
		.replace(/\x60[^\x60]*\x60/g, "")
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
