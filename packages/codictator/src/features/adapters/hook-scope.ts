// SPEC §4.3.2 + §4.7: the L1 hook scope for the adapter runtime. Split
// from runtime.ts; the scope stays lexical (no disk reads) so every
// harness path judges the one tool call, not the tree.
import { analyseShell } from "../../kernel/index.ts";
import type { Scope } from "../engine/index.ts";
import type { HookEvent } from "./contract.ts";

// SPEC §4.3.2 + §4.7: the L1 hook scope is the one tool call, not the
// disk tree. Harness tool paths are absolute and usually name files that
// do not exist yet, so scoping them for disk reads would fail closed on
// every benign call. The proposed write content and the shell command
// text ride the scope instead, for the L1 enforcers to judge, together
// with the lexical write/read targets: the tool file paths plus the shell
// redirection targets parsed from the command. Absolute targets resolve
// lexically against the repo root; anything else stays as spelled. No
// disk is read: target existence is never probed.
function relativizeTarget(root: string, target: string): string {
	const slashed = target.replace(/\\/g, "/");
	const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
	if (slashed === base) {
		return ".";
	}
	if (slashed.startsWith(`${base}/`)) {
		return slashed.slice(base.length + 1);
	}
	return target;
}

export function hookScope(event: HookEvent, root: string): Scope {
	const tool = event.tool;
	const targets = new Set<string>();
	for (const raw of tool?.paths ?? []) {
		targets.add(relativizeTarget(root, raw));
	}
	// SPEC §4.7.3 EC-8: shell redirection targets (`>`, `>>`, `tee`,
	// `Out-File`, `cp`/`mv` destinations) are write targets too. The parse
	// is lexical only (analyseShell never touches the disk); an
	// unparseable command contributes no targets because the
	// dangerous-shell enforcer already blocks it fail-closed (CDX-E306).
	const command = tool?.command;
	if (command !== undefined && command !== "") {
		const parsed = analyseShell(command);
		if (parsed.ok) {
			for (const target of parsed.value.writeTargets) {
				targets.add(relativizeTarget(root, target));
			}
		}
	}
	return {
		files: [],
		sessionId: event.sessionId,
		...(tool?.proposedContent === undefined
			? {}
			: { proposedContent: tool.proposedContent }),
		...(command === undefined ? {} : { shellCommand: command }),
		...(targets.size === 0 ? {} : { proposedPaths: [...targets].sort() }),
	};
}
