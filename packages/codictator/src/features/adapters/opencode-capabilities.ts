// SPEC §4.5.2 with §4.5.4: the OpenCode capability declaration. Unverified
// stays false or none per §7.9; every gap is covered by L3/L4, never claimed
// as enforced. hookIoVerified flips only with a first-party capture (§4.5.7).
import type { CapabilityDeclaration } from "./contract.ts";

export const OPENCODE_CAPABILITIES: CapabilityDeclaration = {
	harness: "opencode",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "1.19.4",
		date: "2026-10-26",
		source:
			"@opencode-ai/plugin Hooks type at tag v1.19.4; vendor plugins page",
	},
	layers: {
		L0: "native",
		L1: "native",
		L2: "none",
		L3: "native",
		L4: "native",
		L5: "none",
	},
	controls: {
		contextFile: true,
		contextInject: true,
		postCompactInject: true,
		promptBlock: false,
		preToolBlock: true,
		readBlock: true,
		postToolFeedback: false,
		autoCompactConfig: "partial",
		forceCompact: false,
		forceClear: false,
		usageData: "none",
		skills: false,
		subagents: false,
		commands: false,
		projectPermissions: false,
		trustRequired: false,
		timeoutFailMode: "closed",
		launcherMissingFailMode: "closed",
		hookIoVerified: false,
		projectRootSource: "cwd",
		agentEnvMarkers: ["CODICTATOR_AGENT"],
	},
	gaps: [
		"hookIoVerified is false until a first-party capture passes (§4.5.7)",
		"contextInject and promptBlock stay partial until a first-party capture",
		"session.* events are observe-only",
		"skills directory unverified",
		"OpenCode 2.x reshapes the plugin API and stays a gap per the range",
	],
};
