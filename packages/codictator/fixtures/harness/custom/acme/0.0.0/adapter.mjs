// Reference custom adapter fixture for the SPEC §4.5.6 contract tests.
// Lives under fixtures (never imported by src/); the 12.7 loader imports the
// copy seeded into each test's temp repo at .codictator/adapters/acme/.
// Its parse/reply/render outputs must stay byte-identical to the goldens
// beside it: tool-pre-write.json, reply-block.json, render/acme-hooks.json.
export const adapter = {
	id: "custom:acme",
	capabilities: {
		harness: "custom:acme",
		adapterVersion: "0.0.0",
		verifiedAgainst: {
			version: "0.0.0",
			date: "2026-10-26",
			source:
				"first-party fixture packages/codictator/fixtures/harness/custom/acme/0.0.0",
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
			timeoutFailMode: "closed",
			launcherMissingFailMode: "closed",
			hookIoVerified: true,
			projectRootSource: "payload-cwd",
			agentEnvMarkers: [],
		},
		gaps: [],
	},
	parse(event, raw) {
		if (event !== "tool.pre.write") {
			return {
				ok: false,
				error: {
					code: "CDX-E303",
					message: `unsupported acme event "${event}"`,
					remediation: "Send beforeWrite for tool.pre.write.",
				},
			};
		}
		const input = raw?.tool_input ?? {};
		return {
			ok: true,
			value: {
				harness: "custom:acme",
				event: "beforeWrite",
				trigger: "tool.pre.write",
				sessionId: raw?.session_id,
				cwd: raw?.cwd,
				tool: {
					kind: "write",
					name: "writeFile",
					paths: [input.file_path],
					proposedContent: input.content,
				},
			},
		};
	},
	reply(decision) {
		if (decision.decision === "block") {
			return {
				exitCode: 2,
				stdout: JSON.stringify({
					acme: "deny",
					reason: decision.message ?? "",
					eventId: decision.eventId,
				}),
				stderr: "",
			};
		}
		return {
			exitCode: 0,
			stdout: JSON.stringify({ acme: "allow", eventId: decision.eventId }),
			stderr: "",
		};
	},
	render() {
		return [
			{
				path: "acme-hooks.json",
				content: `{
	"version": 1,
	"hooks": [
		{
			"event": "beforeWrite",
			"command": "node .codictator/bin/run.mjs hook custom:acme beforeWrite"
		}
	]
}
`,
			},
		];
	},
};
