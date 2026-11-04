// SPEC §4.5 + §4.13.1 step 2: built-in harness file rendering for the
// guardrail plan. Each known harness id dispatches to its own adapter's
// render, so L1 enforcement ships with init and regen; the adapters stay
// the sole owners of their file shapes (§3.3).
import { claudeCodeAdapter } from "./claude-code.ts";
import { codexCliAdapter } from "./codex-cli.ts";
import type { RenderInput } from "./contract.ts";
import { copilotAdapter } from "./copilot.ts";
import { cursorAdapter } from "./cursor.ts";
import { geminiCliAdapter } from "./gemini-cli.ts";
import { museAdapter } from "./muse-code.ts";
import { opencodeAdapter } from "./opencode.ts";

export interface HarnessFile {
	readonly path: string;
	readonly content: string;
	readonly owner: string;
}

// SPEC §4.5.8 EC-12: regen input is fixed, so unchanged config reproduces
// every harness file byte for byte. All built-in renders ignore the input;
// the cwd is still threaded through honestly for the adapters that read it.
function regenInput(harness: string, root: string): RenderInput {
	return {
		event: {
			harness,
			event: "session.start",
			trigger: "startup",
			sessionId: "regen",
			cwd: root,
		},
		decision: { decision: "allow", eventId: "regen" },
	};
}

// SPEC §4.14.1: every generated artifact carries its adapter owner.
// Unknown non-custom ids are skipped here because config validation owns
// CDX-E301 and rejects them there; this render path never emits that error.
export function renderHarnessFiles(
	harnesses: ReadonlyArray<string>,
	root: string,
): Array<HarnessFile> {
	const ids = [...new Set(harnesses)].sort();
	const files: Array<HarnessFile> = [];
	for (const harness of ids) {
		if (harness.startsWith("custom:")) {
			continue;
		}
		const input = regenInput(harness, root);
		if (harness === museAdapter.id) {
			for (const artifact of museAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		} else if (harness === claudeCodeAdapter.id) {
			for (const artifact of claudeCodeAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		} else if (harness === opencodeAdapter.id) {
			for (const artifact of opencodeAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		} else if (harness === copilotAdapter.id) {
			for (const artifact of copilotAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		} else if (harness === codexCliAdapter.id) {
			for (const artifact of codexCliAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		} else if (harness === cursorAdapter.id) {
			for (const artifact of cursorAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		} else if (harness === geminiCliAdapter.id) {
			for (const artifact of geminiCliAdapter.render(input)) {
				files.push({ ...artifact, owner: harness });
			}
		}
	}
	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return files;
}

// SPEC §4.14.1: custom fragments carry no owner of their own, so they keep
// the historical codictator owner instead of inheriting a harness.
export function withCodictatorOwner(
	files: ReadonlyArray<{ path: string; content: string }>,
): Array<{ path: string; content: string; owner: string; mode: "file" }> {
	return files.map((entry) => ({
		...entry,
		owner: "codictator",
		mode: "file",
	}));
}
