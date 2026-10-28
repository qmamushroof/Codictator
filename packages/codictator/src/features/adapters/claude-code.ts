// SPEC §4.5.4: the Claude Code reply shape only. Parse already rides the
// shared Claude-shaped contract (§4.5.3, claude-shaped.ts); this module adds
// the matching reply so the launcher and the CLI start path can deny in
// Claude Code's own form (exit 2 + stderr, SPEC §4.5.8 EC-9) without waiting
// for the full adapter. Render, capabilities and the bridge land in phase 9.4
// with §4.5 EC-3–8 and EC-10, so nothing here claims hookIoVerified.
import type { HookDecision, HookReply } from "./contract.ts";

// SPEC §4.5.4 Claude Code row: a pre-tool block is exit 2 + stderr and can
// never be overridden by a JSON allow, so a block carries no stdout at all.
// Inject is exit 0 with hookSpecificOutput.additionalContext; post-tool
// feedback and Stop continuation are JSON decision blocks, which the engine
// verdict path (phase 9) renders. Allow is exit 0 with empty stdout.
export function replyClaudeCode(decision: HookDecision): HookReply {
	if (decision.decision === "block" || decision.decision === "escalate") {
		return {
			exitCode: 2,
			stdout: "",
			stderr: decision.message ?? "blocked",
		};
	}
	if (
		decision.additionalContext !== undefined &&
		decision.additionalContext.length > 0
	) {
		return {
			exitCode: 0,
			stdout: JSON.stringify({
				hookSpecificOutput: {
					additionalContext: decision.additionalContext,
				},
			}),
			stderr: "",
		};
	}
	return { exitCode: 0, stdout: "", stderr: "" };
}

// SPEC §4.5.1: the pre-engine deny form, embedded by regen for CDX-E002 and
// CDX-E003. No engine state, so it works when the engine is missing.
export function staticBlockClaudeCode(
	code: string,
	message: string,
): HookReply {
	return replyClaudeCode({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}
