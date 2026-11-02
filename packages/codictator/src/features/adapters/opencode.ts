// SPEC §4.5.4: the OpenCode adapter. Parse, reply and staticBlock are pure;
// hookIoVerified stays false until a first-party capture lands (§4.5.7).
// Tables live in opencode-tables.ts and payload narrowing in
// opencode-parse.ts; this file owns the reply/render/adapter assembly and
// keeps the original barrel path, so existing imports keep working.
import { stableStringify } from "../../kernel/index.ts";
import type {
	Adapter,
	FileArtifact,
	HookDecision,
	HookReply,
	RenderInput,
} from "./contract.ts";
import { OPENCODE_BRIDGE_SOURCE } from "./opencode-bridge.ts";
import { OPENCODE_CAPABILITIES } from "./opencode-capabilities.ts";
import { parseOpenCodeEvent } from "./opencode-parse.ts";
import { normalizeOpenCodeToolName } from "./opencode-tables.ts";

export { normalizeOpenCodeToolName, parseOpenCodeEvent };

// SPEC §4.5.4 with S29: the wire is Codictator's own HookDecision JSON on
// stdout, exit 0. The bridge throws on a block reply, so gating stays closed.
export function replyOpenCode(decision: HookDecision): HookReply {
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			decision: decision.decision,
			...(decision.message === undefined ? {} : { message: decision.message }),
			...(decision.additionalContext === undefined
				? {}
				: { additionalContext: decision.additionalContext }),
			eventId: decision.eventId,
		}),
		stderr: "",
	};
}

// SPEC §4.5.1: the pre-engine deny form, embedded by regen for CDX-E002 and
// CDX-E003. No engine state, so it works when the engine is missing.
export function staticBlockOpenCode(code: string, message: string): HookReply {
	return replyOpenCode({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

// SPEC §4.5.4 OpenCode version range (SPEC §11 S32): the hooks above exist
// in the type definitions across >=1.15.0 <2.0.0. status compares
// opencode --version against this range (EC-24); outside it, L1 and
// contextInject show unknown while L3 and L4 keep enforcing.
export const OPENCODE_VERSION_MINIMUM = "1.15.0";
export const OPENCODE_VERSION_MAXIMUM_EXCLUSIVE = "2.0.0";

function versionParts(version: string): Array<number> | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (match === null) {
		return undefined;
	}
	const parts = match.slice(1, 4).map((part) => Number(part));
	if (parts.some((part) => !Number.isSafeInteger(part))) {
		return undefined;
	}
	return parts as Array<number>;
}

function compareVersions(left: Array<number>, right: Array<number>): number {
	for (let index = 0; index < 3; index += 1) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		if (a !== b) {
			return a < b ? -1 : 1;
		}
	}
	return 0;
}

export function isOpenCodeVersionSupported(version: string): boolean {
	const seen = versionParts(version);
	const minimum = versionParts(OPENCODE_VERSION_MINIMUM);
	const maximum = versionParts(OPENCODE_VERSION_MAXIMUM_EXCLUSIVE);
	if (seen === undefined || minimum === undefined || maximum === undefined) {
		return false;
	}
	return (
		compareVersions(seen, minimum) >= 0 && compareVersions(seen, maximum) < 0
	);
}

// SPEC §4.5.4: owned opencode.json keys. Bypass-command deny patterns come
// from §4.14.3 in phase 9; until then the owned list is empty.
function renderOpenCodeJson(): string {
	return stableStringify({
		compaction: { auto: true },
		permission: { bash: [] },
	});
}

function renderOpenCode(_input: RenderInput): Array<FileArtifact> {
	return [
		{
			path: ".opencode/plugins/codictator.mjs",
			content: OPENCODE_BRIDGE_SOURCE,
		},
		{ path: "opencode.json", content: renderOpenCodeJson() },
	];
}

export const opencodeAdapter: Adapter = {
	id: "opencode",
	capabilities: OPENCODE_CAPABILITIES,
	render: renderOpenCode,
	parse: parseOpenCodeEvent,
	reply: replyOpenCode,
	staticBlock: staticBlockOpenCode,
};
