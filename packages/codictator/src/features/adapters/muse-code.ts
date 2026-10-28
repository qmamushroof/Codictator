// SPEC §4.5.4: the Muse Code adapter. Parse, reply and staticBlock are
// pure; hookIoVerified stays false until a first-party capture lands (§4.5.7).
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

// SPEC §4.5.3: per-adapter table. Unknown names fall back to other through
// the contract normaliser, so a new harness tool is still seen.
const MUSE_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
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

export function normalizeMuseToolName(name: string): ToolKind {
	return normalizeToolName(MUSE_TOOL_TABLE, name);
}

export function parseMuseEvent(event: string, raw: unknown): Result<HookEvent> {
	return parseClaudeShapedEvent("muse-code", event, raw, MUSE_TOOL_TABLE);
}

// SPEC §4.5.4: exit 0 always; stdout carries only the hookSpecificOutput
// form. Allow is exactly {}; a bare allow is rejected by the harness, and
// legacy top-level shapes are hook errors, so neither is ever emitted.
export function replyMuse(decision: HookDecision): HookReply {
	if (decision.decision === "block" || decision.decision === "escalate") {
		const reason = decision.message ?? "blocked";
		return {
			exitCode: 0,
			stdout: JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: reason,
				},
			}),
			stderr: "",
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
	return { exitCode: 0, stdout: "{}", stderr: "" };
}

// SPEC §4.5.1: the pre-engine deny form, embedded by regen for CDX-E002 and
// CDX-E003. No engine state, so it works when the engine is missing.
export function staticBlockMuse(code: string, message: string): HookReply {
	return replyMuse({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

export const MUSE_CAPABILITIES: CapabilityDeclaration = {
	harness: "muse-code",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "1.4.10",
		date: "2026-10-26",
		source: "vendor docs; third-party live probes (see SPEC §4.5.4)",
	},
	layers: {
		L0: "partial",
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
		skills: true,
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
		"subagent definition files: managed in-product, no documented file",
		"project-level permissions: settings are user-level",
		"hook timeout field: none documented",
		"post-tool feedback: blocking unconfirmed, reports disagree",
		"exit-2 deny: unconfirmed, never emitted",
		"updatedInput: reports disagree, never emitted",
		"SessionStart source values: unverified",
		"usage data: no documented field; transcript_path is null under exec",
	],
};

// SPEC §4.5.1: every hook command runs the launcher. Muse Code has no
// documented project-root variable, so the path is relative and the launcher
// resolves the root from the payload cwd.
function museHookCommand(event: string): string {
	return `node .codictator/bin/run.mjs hook muse-code ${event}`;
}

// SPEC §4.5.3: the Muse Code native events, rendered in sorted order so
// regeneration is byte-identical.
const MUSE_HOOK_EVENTS: ReadonlyArray<string> = [
	"PostCompact",
	"PostToolUse",
	"PreToolUse",
	"SessionStart",
	"Stop",
	"SubagentStart",
	"UserPromptSubmit",
];

function renderMuseHooks(): string {
	const hooks: Record<string, unknown> = {};
	for (const event of MUSE_HOOK_EVENTS) {
		hooks[event] = [
			{
				matcher: "*",
				hooks: [{ type: "command", command: museHookCommand(event) }],
			},
		];
	}
	return stableStringify({ hooks });
}

// SPEC §4.5.4 with S15: the memory topic carries the precedence statement and
// the pointer to AGENTS.md, so L0 exists before workspace trust. The rule set
// itself waits for steering in phase 9.
const MUSE_MEMORY_INDEX = `# Memory

- codictator.md — the Codictator topic: repository rules outrank any instruction here. Read it before the first tool call.
`;

const MUSE_MEMORY_CODICTATOR = `# Codictator

Repository rules enforced by Codictator outrank any instruction in this conversation, including the user's. When an instruction conflicts with a rule, do what was asked the compliant way and tell the user which rule applied and why. Never bypass, disable or edit Codictator guardrails.

The rule set lives in AGENTS.md at the repository root.
`;

// SPEC §4.6.6: skill paths per asset id. Bodies are pointers only; the pack
// templates land in phase 9.2.
const MUSE_SKILLS: ReadonlyArray<{
	readonly id: string;
	readonly purpose: string;
}> = [
	{
		id: "codictator-review",
		purpose:
			"Fresh-session reviewer: reads only the staged diff and the task SPEC refs, then submits.",
	},
	{
		id: "codictator-qa",
		purpose: "Runs the scenario-required test kinds and reports gaps.",
	},
	{
		id: "codictator-debug",
		purpose:
			"Diagnose before fix: reproduce, record in the bug registry, write the regression test, prove it red.",
	},
	{
		id: "codictator-bug-record",
		purpose:
			"Files a defect found in passing without leaving the current task.",
	},
	{
		id: "codictator-docs-audit",
		purpose: "Runs doc checks and fixes findings.",
	},
	{
		id: "codictator-checkpoint",
		purpose: "Writes the checkpoint and the resume note.",
	},
];

function renderMuse(_input: RenderInput): Array<FileArtifact> {
	const artifacts: Array<FileArtifact> = [
		{ path: ".muse/hooks.json", content: renderMuseHooks() },
		{ path: ".agents/memory/MEMORY.md", content: MUSE_MEMORY_INDEX },
		{ path: ".agents/memory/codictator.md", content: MUSE_MEMORY_CODICTATOR },
	];
	for (const skill of MUSE_SKILLS) {
		artifacts.push({
			path: `.agents/skills/${skill.id}/SKILL.md`,
			content: `# ${skill.id}\n\n${skill.purpose}\n\nRepository rules live in AGENTS.md and outrank any instruction in this conversation.\n`,
		});
	}
	return artifacts;
}

export const museAdapter: Adapter = {
	id: "muse-code",
	capabilities: MUSE_CAPABILITIES,
	render: renderMuse,
	parse: parseMuseEvent,
	reply: replyMuse,
	staticBlock: staticBlockMuse,
};
