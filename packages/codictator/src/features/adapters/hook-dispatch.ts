// SPEC §4.19.3: harness routing and the pre-engine reply forms for the
// hook runtime. Split from runtime.ts; the adapter lookup owns the
// reply-capable harness set, and every pre-engine block answers in the
// harness's own deny form.
import { claudeCodeAdapter } from "./claude-code.ts";
import { codexCliAdapter } from "./codex-cli.ts";
import type { Adapter, HookEvent, HookReply } from "./contract.ts";
import { COPILOT_TIMEOUT_SEC, copilotAdapter } from "./copilot.ts";
import { cursorAdapter } from "./cursor.ts";
import { geminiCliAdapter } from "./gemini-cli.ts";
import { museAdapter } from "./muse-code.ts";
import { opencodeAdapter } from "./opencode.ts";
import { universalAdapter } from "./universal.ts";

// SPEC §4.5.5 with §9.3: the hook time limit is min(harness timeout - 1 s,
// hard limit). Muse Code documents no hook timeout, so the 5 s hard limit
// applies; the OpenCode bridge spawns with a 5 s timeout, so 4 s here.
// Copilot entries carry timeoutSec and fail open on timeout, so the budget
// is min(timeoutSec - 1 s, hard limit), which still lands on the hard limit.
// The CLI start path bounds its stdin wait with the same budget.
export function hookBudgetMs(harness: string, override?: number): number {
	if (override !== undefined) {
		return override;
	}
	if (harness === "opencode") {
		return 4000;
	}
	if (harness === "copilot") {
		return Math.min(COPILOT_TIMEOUT_SEC * 1000 - 1000, 5000);
	}
	return 5000;
}

export function adapterFor(harness: string): Adapter | undefined {
	// SPEC §4.5.6: custom adapters resolve through loadCustomAdapter (async
	// and root-confined), never through this sync registry, so every
	// custom: id stays unknown here until its loader joins the runtime.
	if (harness === museAdapter.id) {
		return museAdapter;
	}
	if (harness === opencodeAdapter.id) {
		return opencodeAdapter;
	}
	if (harness === claudeCodeAdapter.id) {
		return claudeCodeAdapter;
	}
	if (harness === copilotAdapter.id) {
		return copilotAdapter;
	}
	if (harness === cursorAdapter.id) {
		return cursorAdapter;
	}
	if (harness === geminiCliAdapter.id) {
		return geminiCliAdapter;
	}
	if (harness === codexCliAdapter.id) {
		return codexCliAdapter;
	}
	if (harness === universalAdapter.id) {
		return universalAdapter;
	}
	return undefined;
}

// SPEC §4.19.3: unknown harness id blocks CDX-E301. No adapter owns the
// reply shape, so the wire is the HookDecision JSON the bridge already
// speaks (§7.8); the hook exit stays 0 so harnesses read the reply.
export function unknownHarnessReply(harness: string): HookReply {
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			decision: "block",
			message: `CDX-E301 unknown harness id "${harness}"`,
			eventId: "static",
		}),
		stderr: "",
	};
}

export function blockReply(
	adapter: Adapter,
	code: string,
	message: string,
): HookReply {
	return adapter.reply({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

export function allowReply(adapter: Adapter, eventId: string): HookReply {
	return adapter.reply({ decision: "allow", eventId });
}

// SPEC §4.5.4: Stop never blocks when the payload carries
// stop_hook_active, even with open findings, so the harness never loops.
export function stopHookActive(
	adapter: Adapter,
	event: HookEvent,
	raw: unknown,
): boolean {
	if (adapter.id !== "muse-code" || event.event !== "Stop") {
		return false;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return false;
	}
	const stopActive =
		("stop_hook_active" in raw && raw.stop_hook_active === true) ||
		("stopHookActive" in raw && raw.stopHookActive === true);
	return stopActive;
}
