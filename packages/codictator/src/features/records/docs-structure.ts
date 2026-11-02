// SPEC §4.9.2: doc shape checks — router/leaf topology, size, breadth.
// Line vocabulary lives in docs-lines.ts. All functions are pure over
// caller-supplied trees; this module never touches the filesystem
// (SPEC §3.3, §10.3 item 3).
import { normalizeText } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import type { DocFile, DocLimits } from "./docs-lines.ts";
import {
	isHeading,
	isLinkOnlyLine,
	isTableRow,
	stripFences,
} from "./docs-lines.ts";

export type { DocFile, DocLimits } from "./docs-lines.ts";
export { isTableRow } from "./docs-lines.ts";

// SPEC §5.10: the tunable defaults the limits ship with.
export const DEFAULT_DOC_LIMITS: DocLimits = {
	maxBytes: 40000,
	maxLines: 500,
	maxH2: 15,
	maxFilesPerFolder: 40,
	maxSentenceWords: 40,
	maxParagraphSentences: 6,
};

const LEAF_NAME_PATTERN = /^\d{2}(-\d{2})?-[A-Z0-9]+(-[A-Z0-9]+)*\.md$/;

export interface RouterLeaf {
	readonly name: string;
	readonly text: string;
}

export interface RouterTree {
	readonly routerPath: string;
	readonly routerText: string;
	readonly leaves: ReadonlyArray<RouterLeaf>;
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
		if (match[1] !== undefined) {
			slots.push(match[1].split("/").pop() ?? match[1]);
		} else {
			slots.push(`(${match[2] ?? ""})`);
		}
		match = pattern.exec(line);
	}
	return slots;
}

function routerIntroFindings(tree: RouterTree): Array<Finding> {
	const routerName = tree.routerPath.split("/").pop() ?? tree.routerPath;
	const prose = normalizeText(tree.routerText)
		.split("\n")
		.filter(
			(line) =>
				line.trim() !== "" &&
				!isHeading(line) &&
				!isTableRow(line) &&
				!isLinkOnlyLine(line),
		);
	if (prose.length <= 1) {
		return [];
	}
	return [
		{
			ruleId: "core/doc-router-leaf",
			path: tree.routerPath,
			message: `router holds prose beyond its one-line intro: ${routerName}`,
			remediation: `Keep only the H1, a single intro line and tables in ${tree.routerPath}; move the paragraph to a leaf.`,
		},
	];
}

function leafNameFindings(tree: RouterTree): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const leaf of tree.leaves) {
		if (LEAF_NAME_PATTERN.test(leaf.name)) {
			continue;
		}
		findings.push({
			ruleId: "core/doc-router-leaf",
			path: `${tree.routerPath}`,
			message: `leaf name outside the router pattern: ${leaf.name}`,
			remediation: `Rename the leaf to NN-NAME.md or NN-MM-NAME.md with uppercase segments, e.g. 04-09-RECORDS.md.`,
		});
	}
	return findings;
}

function leafLinkFindings(
	tree: RouterTree,
	leafNames: ReadonlyArray<string>,
	linked: ReadonlyArray<string>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const name of leafNames) {
		const seen = linked.filter(
			(target) => (target.split("/").pop() ?? target) === name,
		).length;
		if (seen === 1) {
			continue;
		}
		const detail =
			seen === 0 ? "missing from router" : `linked ${seen} times in router`;
		findings.push({
			ruleId: "core/doc-router-leaf",
			path: tree.routerPath,
			message: `leaf ${detail}: ${name}`,
			remediation: `Link [${name}](${name}) exactly once in ${tree.routerPath}, in file-name order.`,
		});
	}
	const routerName = tree.routerPath.split("/").pop() ?? tree.routerPath;
	const ordered = linked
		.map((target) => target.split("/").pop() ?? target)
		.filter((leaf) => leafNames.includes(leaf));
	const expectedOrder = leafNames.filter((leaf) => ordered.includes(leaf));
	if (ordered.join("\n") !== expectedOrder.join("\n")) {
		findings.push({
			ruleId: "core/doc-router-leaf",
			path: tree.routerPath,
			message: `router leaf links out of file-name order in ${routerName}`,
			remediation: `Order the leaf links in ${tree.routerPath} as: ${expectedOrder.join(", ")}.`,
		});
	}
	return findings;
}

// Slots are previous (link or "(first)"), the router link, next
// (link or "(last)"), matching router order.
function navExpected(
	routerPath: string,
	previous: string | undefined,
	next: string | undefined,
): Array<string> {
	const routerBase = routerPath.split("/").pop() ?? routerPath;
	const first = previous === undefined ? "(first)" : previous;
	const last = next === undefined ? "(last)" : next;
	return [first, routerBase, last];
}

function checkNavLines(
	tree: RouterTree,
	leafNames: ReadonlyArray<string>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const [index, name] of leafNames.entries()) {
		const leaf = tree.leaves.find((entry) => entry.name === name);
		if (leaf === undefined) {
			continue;
		}
		const previous = index === 0 ? undefined : leafNames[index - 1];
		const next =
			index === leafNames.length - 1 ? undefined : leafNames[index + 1];
		const expected = navExpected(tree.routerPath, previous, next);
		const actual = navSlots(firstContentLine(leaf.text)).slice(0, 3);
		if (actual.join("\n") === expected.join("\n")) {
			continue;
		}
		findings.push({
			ruleId: "core/doc-router-leaf",
			path: tree.routerPath,
			message: `nav line of ${name} points at the wrong neighbours`,
			remediation: expectedNavLine(tree.routerPath, previous, next),
		});
	}
	return findings;
}

// SPEC §4.9.2 core/doc-router-leaf: the router holds only an H1, an
// optional one-line intro and tables; every leaf links exactly once in
// file-name order; every leaf carries the matching nav line.
export function checkDocRouterLeaf(tree: RouterTree): Array<Finding> {
	const leafNames = tree.leaves.map((leaf) => leaf.name).sort();
	const linked = routerLinkTargets(tree.routerText).filter((target) =>
		target.split("/").pop(),
	);
	return [
		...routerIntroFindings(tree),
		...leafNameFindings(tree),
		...leafLinkFindings(tree, leafNames, linked),
		...checkNavLines(tree, leafNames),
	];
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
