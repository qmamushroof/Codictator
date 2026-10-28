// SPEC §4.5.4: the Universal adapter. It covers every harness with no
// native adapter through the shared files (PRD §7.3): AGENTS.md, the git
// hooks and the CI workflow. It owns no harness-native files and sees no
// hook traffic, so L1 is none and parse fails closed; enforcement rides on
// L3/L4 once integrity (§4.14) and CI (§4.15) land in phases 9.5 and 9.6.
import type { Result } from "../../kernel/index.ts";
import { err, makeError } from "../../kernel/index.ts";
import type {
	Adapter,
	CapabilityDeclaration,
	FileArtifact,
	HookDecision,
	HookEvent,
	HookReply,
	RenderInput,
} from "./contract.ts";

export const UNIVERSAL_CAPABILITIES: CapabilityDeclaration = {
	harness: "universal",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "1.0.0",
		date: "2026-10-26",
		source:
			"no vendor release; fixture note packages/codictator/fixtures/harness/universal/1.0.0 (§4.5.7)",
	},
	layers: {
		L0: "native",
		L1: "none",
		L2: "none",
		L3: "native",
		L4: "native",
		L5: "none",
	},
	controls: {
		contextFile: true,
		contextInject: false,
		postCompactInject: false,
		promptBlock: false,
		preToolBlock: false,
		readBlock: false,
		postToolFeedback: false,
		autoCompactConfig: "none",
		forceCompact: false,
		forceClear: false,
		usageData: "none",
		skills: false,
		subagents: false,
		commands: false,
		projectPermissions: false,
		trustRequired: false,
		timeoutFailMode: "unknown",
		launcherMissingFailMode: "unknown",
		hookIoVerified: false,
		projectRootSource: "git",
		agentEnvMarkers: [],
	},
	gaps: [
		"no native hook traffic: L1 is none by design, never verified",
		"git-hook and CI enforcement land with phases 9.5 and 9.6",
	],
};

// SPEC §4.5.4: no native hook traffic exists, so any hook payload fails
// closed with CDX-E303. This is unreachable through regen (no hook command
// is ever installed for universal); it only guards a hand-run launcher.
export function parseUniversalEvent(
	event: string,
	_raw: unknown,
): Result<HookEvent> {
	return err(
		makeError(
			"CDX-E303",
			`unparseable universal hook payload: no hook traffic for ${event}`,
			"Configure a native harness adapter, or rely on git hooks and CI.",
		),
	);
}

// SPEC §4.5.1: the static deny form. Universal has no native deny shape, so
// the wire is Codictator's own HookDecision JSON, the same wire the OpenCode
// bridge already speaks (§7.8).
export function replyUniversal(decision: HookDecision): HookReply {
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

export function staticBlockUniversal(code: string, message: string): HookReply {
	return replyUniversal({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

// SPEC §4.5.4: universal owns no harness-native files. AGENTS.md is rendered
// by steering (§4.6.2), the git hooks by integrity (§4.14.4) and the workflow
// by CI (§4.15); this render stays empty so regen never writes a file here.
function renderUniversal(_input: RenderInput): Array<FileArtifact> {
	return [];
}

export const universalAdapter: Adapter = {
	id: "universal",
	capabilities: UNIVERSAL_CAPABILITIES,
	render: renderUniversal,
	parse: parseUniversalEvent,
	reply: replyUniversal,
	staticBlock: staticBlockUniversal,
};
