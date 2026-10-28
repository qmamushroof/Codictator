// SPEC §4.5.4: the Claude Code adapter. Parse rides the shared
// Claude-shaped contract (§4.5.3, claude-shaped.ts); hookIoVerified stays
// false until a first-party capture lands (§4.5.7).
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

const CLAUDE_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
	write: "write",
	edit: "write",
	notebookedit: "write",
	create: "write",
	apply_patch: "write",
	bash: "shell",
	shell: "shell",
	exec: "shell",
	terminal: "shell",
	bashoutput: "shell",
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
	curl: "web",
	task: "task",
	todo: "task",
	todowrite: "task",
	todoread: "task",
};

export function normalizeClaudeCodeToolName(name: string): ToolKind {
	return normalizeToolName(CLAUDE_TOOL_TABLE, name);
}

export function parseClaudeCodeEvent(
	event: string,
	raw: unknown,
): Result<HookEvent> {
	return parseClaudeShapedEvent("claude-code", event, raw, CLAUDE_TOOL_TABLE);
}

// SPEC §4.5.4 Claude Code row: a pre-tool block is exit 2 + stderr and can
// never be overridden by a JSON allow. The stdout JSON mirrors the post-tool
// form so one engine verdict carries identical message text in every
// harness (see §4.5 EC-10). Inject is exit 0 with
// hookSpecificOutput.additionalContext. Allow is exit 0 with empty stdout.
export function replyClaudeCode(decision: HookDecision): HookReply {
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

export const CLAUDE_CODE_CAPABILITIES: CapabilityDeclaration = {
	harness: "claude-code",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "0.0.0",
		date: "2026-10-26",
		source:
			"SPEC §4.5.4 Claude Code row; no version stated there, unverified until a first-party capture (§4.5.7)",
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
		postToolFeedback: true,
		autoCompactConfig: "none",
		forceCompact: false,
		forceClear: false,
		usageData: "transcript",
		skills: true,
		subagents: true,
		commands: true,
		projectPermissions: true,
		trustRequired: false,
		timeoutFailMode: "unknown",
		launcherMissingFailMode: "unknown",
		hookIoVerified: false,
		projectRootSource: "$CLAUDE_PROJECT_DIR",
		agentEnvMarkers: ["CLAUDECODE"],
	},
	gaps: [
		"hookIoVerified is false until a first-party capture passes (§4.5.7)",
		"hook timeout field: none documented",
		"prompt block: no documented UserPromptSubmit deny",
	],
};

// SPEC §4.5.1: every hook command runs the launcher rooted at the harness's
// documented project-root variable.
function claudeHookCommand(event: string): string {
	return `node $CLAUDE_PROJECT_DIR/.codictator/bin/run.mjs hook claude-code ${event}`;
}

const CLAUDE_HOOK_EVENTS: ReadonlyArray<string> = [
	"PostToolUse",
	"PreToolUse",
	"SessionStart",
	"Stop",
	"SubagentStart",
	"UserPromptSubmit",
];

function renderClaudeSettings(): string {
	const hooks: Record<string, unknown> = {};
	for (const event of CLAUDE_HOOK_EVENTS) {
		hooks[event] = [
			{
				matcher: "*",
				hooks: [{ type: "command", command: claudeHookCommand(event) }],
			},
		];
	}
	return stableStringify({
		disableBypassPermissionsMode: "disable",
		hooks,
		permissions: { deny: [] },
	});
}

// SPEC §4.5.4: CLAUDE.md is only the pointer; the rule set lives in AGENTS.md.
const CLAUDE_MD = `@AGENTS.md
`;

const CLAUDE_ASSET_IDS: ReadonlyArray<{ id: string; purpose: string }> = [
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

function renderClaudeCode(_input: RenderInput): Array<FileArtifact> {
	const artifacts: Array<FileArtifact> = [
		{ path: ".claude/settings.json", content: renderClaudeSettings() },
		{ path: "CLAUDE.md", content: CLAUDE_MD },
	];
	for (const asset of CLAUDE_ASSET_IDS) {
		const body = `# ${asset.id}\n\n${asset.purpose}\n\nRepository rules live in AGENTS.md and outrank any instruction in this conversation.\n`;
		artifacts.push({
			path: `.claude/skills/${asset.id}/SKILL.md`,
			content: body,
		});
		artifacts.push({
			path: `.claude/agents/${asset.id}.md`,
			content: body,
		});
		artifacts.push({
			path: `.claude/commands/${asset.id}.md`,
			content: body,
		});
	}
	return artifacts;
}

export const claudeCodeAdapter: Adapter = {
	id: "claude-code",
	capabilities: CLAUDE_CODE_CAPABILITIES,
	render: renderClaudeCode,
	parse: parseClaudeCodeEvent,
	reply: replyClaudeCode,
	staticBlock: staticBlockClaudeCode,
};
