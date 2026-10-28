// SPEC §4.5.2 with §4.5.4: the Copilot capability declaration. Unverified
// stays false or none per §7.9; hookIoVerified flips only with a first-party
// capture (§4.5.7). Timeouts fail open, so the runtime budget (§4.5.5) must
// emit the deny before timeoutSec trips.
import type { CapabilityDeclaration } from "./contract.ts";

export const COPILOT_CAPABILITIES: CapabilityDeclaration = {
	harness: "copilot",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "0.0.0",
		date: "2026-10-26",
		source:
			"SPEC §4.5.4 Copilot row; vendor version unpinned until a first-party capture (§4.5.7)",
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
		contextInject: false,
		postCompactInject: false,
		promptBlock: false,
		preToolBlock: true,
		readBlock: true,
		postToolFeedback: false,
		autoCompactConfig: "none",
		forceCompact: false,
		forceClear: false,
		usageData: "none",
		skills: false,
		subagents: true,
		commands: true,
		projectPermissions: false,
		trustRequired: false,
		timeoutFailMode: "open",
		launcherMissingFailMode: "closed",
		hookIoVerified: false,
		projectRootSource: "cwd",
		agentEnvMarkers: [],
	},
	gaps: [
		"hookIoVerified is false until a first-party capture passes (§4.5.7)",
		"timeouts fail open: the hook self-terminates 1 s before timeoutSec (EC-5)",
		"disableAllHooks: true in any hooks file is tamper, checked at L3/L4 (EC-6)",
		"no usage data; no prompt block or post-tool feedback documented",
	],
};
