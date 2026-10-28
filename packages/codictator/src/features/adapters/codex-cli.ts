// SPEC §4.5.4: the Codex CLI adapter. Parse rides the shared Claude-shaped
// contract (§4.5.3, claude-shaped.ts); reply matches Claude Code (exit 2 +
// stderr). hookIoVerified stays false until a first-party capture (§4.5.7).
import type { Result } from "../../kernel/index.ts";
import { stableStringify } from "../../kernel/index.ts";
import { parseClaudeShapedEvent } from "./claude-shaped.ts";
import type {
	Adapter,
	CapabilityDeclaration,
	FileArtifact,
	HookDecision,
	HookEvent,
	HookReply,
	RenderInput,
	ToolKind,
} from "./contract.ts";
import { normalizeToolName } from "./contract.ts";

const CODEX_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
	write: "write",
	edit: "write",
	create: "write",
	apply_patch: "write",
	bash: "shell",
	shell: "shell",
	exec: "shell",
	terminal: "shell",
	read: "read",
	cat: "read",
	view: "read",
	glob: "search",
	grep: "search",
	search: "search",
	find: "search",
	ls: "search",
	webfetch: "web",
	websearch: "web",
	fetch: "web",
	task: "task",
	todo: "task",
};

export function normalizeCodexToolName(name: string): ToolKind {
	return normalizeToolName(CODEX_TOOL_TABLE, name);
}

export function parseCodexEvent(
	event: string,
	raw: unknown,
): Result<HookEvent> {
	return parseClaudeShapedEvent("codex-cli", event, raw, CODEX_TOOL_TABLE);
}

// SPEC §4.5.4 Codex CLI row: same reply as Claude Code (exit 2 + stderr).
// The stdout JSON mirrors the post-tool form so one engine verdict carries
// identical message text in every harness (see §4.5 EC-10).
export function replyCodex(decision: HookDecision): HookReply {
	if (decision.decision === "block" || decision.decision === "escalate") {
		const reason = decision.message ?? "blocked";
		return {
			exitCode: 2,
			stdout: JSON.stringify({ decision: "block", reason }),
			stderr: reason,
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

export function staticBlockCodex(code: string, message: string): HookReply {
	return replyCodex({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

export const CODEX_CAPABILITIES: CapabilityDeclaration = {
	harness: "codex-cli",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "0.0.0",
		date: "2026-10-26",
		source:
			"SPEC §4.5.4 Codex CLI row; vendor version unpinned until a first-party capture (§4.5.7)",
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
		subagents: false,
		commands: false,
		projectPermissions: false,
		trustRequired: true,
		timeoutFailMode: "unknown",
		launcherMissingFailMode: "unknown",
		hookIoVerified: false,
		projectRootSource: "cwd",
		agentEnvMarkers: [],
	},
	gaps: [
		"hookIoVerified is false until a first-party capture passes (§4.5.7)",
		"project hooks need the project trusted",
		"project .codex/hooks.json is ignored inside git worktrees: status reports L1 inactive there (EC-8, openai/codex#27133)",
		"skills in .agents/skills are unverified for Codex",
		"compaction events and usage data unverified",
	],
};

// SPEC §4.5.1: no documented project-root variable, so the hook command is
// relative and the launcher resolves the root from the payload cwd. The
// timeout rides the runtime budget (§4.5.5), not the rendered file.
function codexHookCommand(event: string): string {
	return `node .codictator/bin/run.mjs hook codex-cli ${event}`;
}

const CODEX_HOOK_EVENTS: ReadonlyArray<string> = [
	"PostToolUse",
	"PreToolUse",
	"SessionStart",
	"Stop",
	"UserPromptSubmit",
];

function renderCodexHooks(): string {
	const hooks: Record<string, unknown> = {};
	for (const event of CODEX_HOOK_EVENTS) {
		hooks[event] = [
			{
				matcher: "*",
				hooks: [{ type: "command", command: codexHookCommand(event) }],
			},
		];
	}
	return stableStringify({ hooks });
}

// SPEC §4.5.4: [features] hooks = true is the only owned config.toml key;
// user entries elsewhere are preserved by regen (§4.14.1).
const CODEX_CONFIG_TOML = `[features]
hooks = true
`;

const CODEX_SKILL_IDS: ReadonlyArray<{ id: string; purpose: string }> = [
	{
		id: "codictator-review",
		purpose: "Fresh-session reviewer: reads only the staged diff.",
	},
	{
		id: "codictator-qa",
		purpose: "Runs the scenario-required test kinds and reports gaps.",
	},
	{ id: "codictator-debug", purpose: "Diagnose before fix, then fix." },
	{
		id: "codictator-bug-record",
		purpose: "Files a defect found in passing.",
	},
	{ id: "codictator-docs-audit", purpose: "Runs doc checks." },
	{ id: "codictator-checkpoint", purpose: "Writes the checkpoint." },
];

function renderCodex(_input: RenderInput): Array<FileArtifact> {
	const artifacts: Array<FileArtifact> = [
		{ path: ".codex/hooks.json", content: renderCodexHooks() },
		{ path: ".codex/config.toml", content: CODEX_CONFIG_TOML },
	];
	for (const skill of CODEX_SKILL_IDS) {
		artifacts.push({
			path: `.agents/skills/${skill.id}/SKILL.md`,
			content: `# ${skill.id}\n\n${skill.purpose}\n\nRepository rules live in AGENTS.md and outrank any instruction in this conversation.\n`,
		});
	}
	return artifacts;
}

export const codexCliAdapter: Adapter = {
	id: "codex-cli",
	capabilities: CODEX_CAPABILITIES,
	render: renderCodex,
	parse: parseCodexEvent,
	reply: replyCodex,
	staticBlock: staticBlockCodex,
};
