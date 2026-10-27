// SPEC §4.2.3: the human-only change path. Human-only commands require an
// interactive TTY on stdin and stdout and refuse to run when any agent
// marker is present, returning CDX-E107.
import type { Env } from "../../kernel/index.ts";
import { type CdxError, makeError } from "../../kernel/index.ts";

// SPEC §4.2.3: set by the launcher in every agent-owned process.
export const HOOK_MARKER = "CODICTATOR_HOOK";

function humanOnlyError(reason: string): CdxError {
	return makeError(
		"CDX-E107",
		`human-only command refused: ${reason}`,
		"Run this command yourself in an interactive terminal, not through an agent or hook.",
	);
}

// SPEC §4.2.3: agent markers are CODICTATOR_HOOK=1 plus every configured
// adapter's agentEnvMarkers (§7.9), which the CLI passes in.
export function requireHuman(
	env: Env,
	isTty: boolean,
	agentMarkers: ReadonlyArray<string> = [],
): void {
	const hook = env.get(HOOK_MARKER);
	if (hook === "1") {
		throw humanOnlyError(`${HOOK_MARKER}=1 is set`);
	}
	for (const marker of agentMarkers) {
		const seen = env.get(marker);
		if (seen !== undefined && seen !== "") {
			throw humanOnlyError(`agent marker ${marker} is set`);
		}
	}
	if (!isTty) {
		throw humanOnlyError("no interactive TTY on stdin and stdout");
	}
}

// SPEC §4.2.4 EC-10: config loading refuses agent-owned processes outright;
// the TTY half of §4.2.3 is enforced by requireHuman at the CLI layer.
export function checkAgentMarkers(env: Env): void {
	const hook = env.get(HOOK_MARKER);
	if (hook === "1") {
		throw humanOnlyError(`${HOOK_MARKER}=1 is set`);
	}
}
