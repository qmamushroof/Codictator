// SPEC §4.3.2 + §4.7: the one pre-tool file adapter. The L1 hook scope is
// the tool call, not the tree (files is empty), so a content rule that loops
// ctx.scope.files never sees the call. This adapter yields the effective
// file set for any trigger: the disk scope files for L3/L4/verify, and for a
// live L1 write the proposed targets carrying the text the call would leave
// (a whole-file write) or the fragment it adds (an edit). A read-only call
// (scope toolAccess "read") judges nothing. A target the call carries no text
// for is skipped, never read from the pre-call disk, unless the rule opts in
// with diskFallback (history-append-only, which compares the disk file with
// HEAD so a tampered worktree file still blocks).
import type { Ports } from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import { type RuleBinding, selectFiles } from "./binding.ts";
import { loadScopeText } from "./health-measures.ts";

export interface EffectiveFile {
	readonly path: string;
	// The text the L1 call carries for this path; unset for a disk scope file
	// (read it) or a pre-tool target the call carries no text for (skip it).
	readonly text?: string;
	// text is the complete file after the call, not an edit fragment.
	readonly whole: boolean;
	readonly proposed: boolean;
}

// How a rule consumes a file: "document" rules (manifest and history
// judgements) need the complete file; "lines" rules (lexical and per-line
// patterns) are sound on an edit fragment too.
export type TextNeed = "document" | "lines";

function proposedFiles(
	ctx: CheckContext,
	globs: ReadonlyArray<string>,
): Array<EffectiveFile> {
	if (ctx.scope.toolAccess === "read") {
		return [];
	}
	const targets = selectFiles(ctx.scope.proposedPaths ?? [], globs);
	// One call content belongs to one target; a shell command or several
	// targets leave the content unassigned.
	const single =
		targets.length === 1 &&
		(ctx.scope.proposedPaths?.length ?? 0) === 1 &&
		ctx.scope.shellCommand === undefined &&
		ctx.scope.proposedContent !== undefined;
	return targets.map((path) => ({
		path,
		whole: single && ctx.scope.proposedContentWhole === true,
		proposed: true,
		...(single && ctx.scope.proposedContent !== undefined
			? { text: ctx.scope.proposedContent }
			: {}),
	}));
}

export function effectiveFiles(
	ctx: CheckContext,
	globs: ReadonlyArray<string>,
): Array<EffectiveFile> {
	if (ctx.trigger === "pre-tool" && ctx.scope.files.length === 0) {
		return proposedFiles(ctx, globs);
	}
	return selectFiles(ctx.scope.files, globs).map((path) => ({
		path,
		whole: true,
		proposed: false,
	}));
}

export async function loadEffectiveText(
	ports: Ports,
	binding: RuleBinding,
	file: EffectiveFile,
	findings: Array<Finding>,
	need: TextNeed,
	diskFallback = false,
): Promise<string | undefined> {
	if (!file.proposed) {
		return loadScopeText(ports, binding, file.path, findings);
	}
	if (file.text === undefined) {
		// A target the call carries no text for: skipped, unless the rule opts
		// into judging the target as it stands on disk (history-append-only
		// compares disk with HEAD, a tampered worktree file still blocks).
		return diskFallback
			? loadScopeText(ports, binding, file.path, findings)
			: undefined;
	}
	return need === "document" && !file.whole ? undefined : file.text;
}

// Visit every effective file whose text the call (or the disk) supplies;
// the rest are skipped (a read finding is already recorded for an unreadable
// disk file).
export async function forEachEffectiveText(
	ctx: CheckContext,
	ports: Ports,
	binding: RuleBinding,
	findings: Array<Finding>,
	need: TextNeed,
	visit: (file: EffectiveFile, text: string) => void | Promise<void>,
): Promise<void> {
	for (const entry of effectiveFiles(ctx, binding.scopeGlobs)) {
		const text = await loadEffectiveText(ports, binding, entry, findings, need);
		if (text !== undefined) {
			await visit(entry, text);
		}
	}
}

export function parentDir(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
}

// SPEC §4.3.2 + §4.7: an L1 scope carries no tree to match first-party
// modules against, so a proposed file looks for the sibling module, package
// or namespace directory on the ancestor directories of the importing file
// (the same directories a Python import root can be). Directory listings
// only: nothing about the target itself is read.
export async function firstPartyNearby(
	ports: Ports,
	top: string,
	file: string,
): Promise<boolean> {
	let dir = parentDir(file);
	for (let depth = 0; depth < 25; depth += 1) {
		try {
			const listed = await ports.fs.list(dir === "" ? "." : dir);
			if (
				listed.ok &&
				listed.value.some(
					(name) =>
						name === top || name === `${top}.py` || name === `${top}.pyi`,
				)
			) {
				return true;
			}
		} catch {
			// A throwing listing reads as no sibling, like a missing manifest.
		}
		if (dir === "") {
			return false;
		}
		dir = parentDir(dir);
	}
	return false;
}

// The names a nearest manifest declares, or why it could not be read.
export interface DeclaredNames {
	readonly names: Set<string>;
	readonly broken: string | undefined;
}
