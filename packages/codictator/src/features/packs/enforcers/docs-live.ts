// SPEC §4.9.2: live doc judging for the structure and content rules that
// first judged fixture marker reports only (BUG-0107). L3 judges the staged
// docs and L4 the changed docs: every relative link, the inline-changelog
// patterns, the router shape and a twelve-word sentence owned twice are
// decidable on the markdown itself. Record docs (§4.9.1) and fixtures stay
// out. The pure checks live in features/records; this file only loads the
// files they judge, so each resolver is one combinator call (core/duplication).
import {
	isFixturePath,
	type Ports,
	type Result,
} from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import {
	checkDocNoInlineChangelog,
	checkDocSingleOwner,
	classifyDoc,
} from "../../records/docs.ts";
import { checkDocLinksValid } from "../../records/docs-prose.ts";
import {
	checkDocRouterLeaf,
	type DocFile,
	type RouterLeaf,
} from "../../records/docs-structure.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { loadScopeText } from "./health-measures.ts";
import {
	forEachMarkerText,
	type MarkerRealArgs,
	markerRealGuard,
} from "./marker-scan.ts";

// SPEC §4.9.1: a non-record, non-fixture markdown file is a real doc.
export function isRealDoc(file: string): boolean {
	return (
		file.endsWith(".md") &&
		!isFixturePath(file) &&
		classifyDoc(file) !== "record"
	);
}

export type LiveDocJudge = (
	args: MarkerRealArgs,
	docs: ReadonlyArray<DocFile>,
) => Promise<Array<Finding>>;

// One resolver for a doc rule: the fixture marker report judges through
// `mark`, the real staged docs through `live`.
export function docRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	mark: (args: MarkerRealArgs, file: string, text: string) => void,
	live: LiveDocJudge,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			forEachMarkerText(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				(file, text) => mark(args, file, text),
			),
		async (args) => {
			const docs: Array<DocFile> = [];
			for (const path of args.files.filter(isRealDoc)) {
				const text = await loadScopeText(
					args.ports,
					args.binding,
					path,
					args.findings,
				);
				if (text !== undefined) {
					docs.push({ path, text });
				}
			}
			if (docs.length > 0) {
				args.findings.push(...(await live(args, docs)));
			}
		},
	);
}

// SPEC §4.9.2 core/doc-no-inline-changelog: a root CHANGELOG.md is a
// changelog by name (§4.9.2 placement lists it), so it is not judged.
export const liveChangelog: LiveDocJudge = (_args, docs) =>
	Promise.resolve(
		checkDocNoInlineChangelog(
			docs.filter((doc) => doc.path !== "CHANGELOG.md"),
		),
	);

// A missing file reads as absent, never as a read finding: whether a link
// target or a router exists is the question the rule asks.
async function readIfPresent(
	ports: Ports,
	path: string,
): Promise<string | undefined> {
	const present = await ports.fs.exists(path);
	if (!present.ok || !present.value) {
		return undefined;
	}
	const read = await ports.fs.readText(path);
	return read.ok ? read.value : undefined;
}

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

function linkedPaths(doc: DocFile): Array<string> {
	const found = new Set<string>();
	for (const match of doc.text.matchAll(LINK)) {
		const raw = match[1] ?? "";
		const target = raw.split("#")[0] ?? "";
		if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
			continue;
		}
		const parts = doc.path.split("/").slice(0, -1);
		for (const piece of target.split("/")) {
			if (piece === "..") {
				parts.pop();
			} else if (piece !== "." && piece !== "") {
				parts.push(piece);
			}
		}
		found.add(parts.join("/"));
	}
	return [...found];
}

// SPEC §4.9.2 core/doc-links-valid: the link targets are read from the tree
// (the staged doc itself is already loaded), so a link to an existing file
// resolves and a missing file or directory does not.
export const liveLinks: LiveDocJudge = async (args, docs) => {
	const known = new Map<string, string>(
		docs.map((doc) => [doc.path, doc.text]),
	);
	for (const target of docs.flatMap(linkedPaths)) {
		if (!known.has(target)) {
			const read = await readIfPresent(args.ports, target);
			if (read !== undefined) {
				known.set(target, read);
			}
		}
	}
	return checkDocLinksValid(docs, known);
};

// SPEC §4.9.1 + §4.9.2 core/doc-router-leaf: a staged router or leaf judges
// its router against the whole folder on disk; a folder with no sibling
// router is no router tree and stays quiet.
export const liveRouters: LiveDocJudge = async (args, docs) => {
	const names = new Set<string>();
	for (const { path } of docs) {
		const name = /^docs\/([^/]+?)(?:\.md|\/[^/]+\.md)$/.exec(path)?.[1];
		if (name !== undefined) {
			names.add(name);
		}
	}
	const findings: Array<Finding> = [];
	for (const name of [...names].sort()) {
		const router = await readIfPresent(args.ports, `docs/${name}.md`);
		const folder = await args.ports.fs.list(`docs/${name}`);
		const files = folder.ok
			? folder.value.filter((file) => file.endsWith(".md"))
			: [];
		if (router === undefined || files.length === 0) {
			continue;
		}
		const leaves: Array<RouterLeaf> = [];
		for (const file of files) {
			const leaf = await readIfPresent(args.ports, `docs/${name}/${file}`);
			if (leaf !== undefined) {
				leaves.push({ name: file, text: leaf });
			}
		}
		findings.push(
			...checkDocRouterLeaf({
				routerPath: `docs/${name}.md`,
				routerText: router,
				leaves,
			}),
		);
	}
	return findings;
};

// SPEC §4.9.1 Managed: the generated agent-instruction files are integrity-only,
// and repeat the rules they steer by design, so they are never an owner.
const MANAGED_DOCS: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md"]);

// SPEC §4.9.2 core/doc-single-owner: a staged doc is compared with every
// other non-record doc on disk, and only a repeat that involves a staged doc
// is reported (the check names its pair as `repeats <owner> in <path>`).
export const liveSingleOwner: LiveDocJudge = async (args, docs) => {
	const judged = docs.filter((doc) => !MANAGED_DOCS.has(doc.path));
	const staged = new Set(judged.map((doc) => doc.path));
	const all = [...judged];
	const listed = await args.ports.fs.glob("**/*.md", "docs");
	for (const path of listed.ok ? listed.value : []) {
		if (staged.has(path) || !isRealDoc(path)) {
			continue;
		}
		const read = await readIfPresent(args.ports, path);
		if (read !== undefined) {
			all.push({ path, text: read });
		}
	}
	return checkDocSingleOwner(all).filter(
		(found) =>
			staged.has(found.path ?? "") ||
			[...staged].some((path) => found.message.includes(` ${path} in `)),
	);
};
