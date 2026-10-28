// SPEC §4.5.4: the GitHub Copilot adapter (CLI, cloud agent, VS Code
// agent). Parse, reply and staticBlock are pure; hookIoVerified stays false
// until a first-party capture lands (§4.5.7), and the hooks-file schema
// below follows the SPEC row verbatim for the same reason.
import type { Result } from "../../kernel/index.ts";
import { err, makeError, ok, stableStringify } from "../../kernel/index.ts";
import type { Trigger } from "../engine/index.ts";
import type {
	Adapter,
	FileArtifact,
	HookDecision,
	HookEvent,
	HookReply,
	HookToolCall,
	RenderInput,
	ToolKind,
} from "./contract.ts";
import { normalizeToolName } from "./contract.ts";
import { COPILOT_CAPABILITIES } from "./copilot-capabilities.ts";

// SPEC §4.5.4 with §4.5.5: hook entries carry timeoutSec; the runtime budget
// is min(timeoutSec − 1 s, the §9.3 hard limit) so the deny below always goes
// out before the harness-side timeout trips (EC-5).
export const COPILOT_TIMEOUT_SEC = 30;

const COPILOT_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
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

export function normalizeCopilotToolName(name: string): ToolKind {
	return normalizeToolName(COPILOT_TOOL_TABLE, name);
}

function mapCopilotEvent(event: string): Trigger | undefined {
	switch (event) {
		case "preToolUse":
		case "tool.pre.write":
		case "tool.pre.shell":
		case "tool.pre.read":
		case "tool.pre.search":
		case "tool.pre.other":
			return "pre-tool";
		case "postToolUse":
		case "tool.post.write":
			return "post-tool";
		case "sessionStart":
		case "session.start":
			return "startup";
		case "userPromptSubmitted":
		case "prompt.submit":
			return "prompt";
		default:
			return undefined;
	}
}

interface CopilotRecord {
	readonly [key: string]: unknown;
	readonly tool?: unknown;
}

function isRecord(value: unknown): value is CopilotRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
	record: CopilotRecord,
	keys: ReadonlyArray<string>,
): string | undefined {
	for (const key of keys) {
		const value: unknown = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function blockError(detail: string): ReturnType<typeof makeError> {
	return makeError(
		"CDX-E303",
		`unparseable copilot hook payload: ${detail}`,
		"Check the harness hook configuration, then retry the tool call.",
	);
}

function readCopilotTool(raw: CopilotRecord): Result<HookToolCall> {
	const container = isRecord(raw.tool) ? raw.tool : raw;
	const name = readString(container, ["name", "tool_name", "toolName"]);
	if (name === undefined) {
		return err(blockError("missing tool name"));
	}
	const paths = new Set<string>();
	for (const key of ["filePath", "file_path", "path", "file"]) {
		const value: unknown = container[key];
		if (typeof value === "string" && value.length > 0) {
			paths.add(value);
		}
	}
	const command = readString(container, ["command"]);
	const query = readString(container, ["query", "pattern", "prompt"]);
	return ok({
		kind: normalizeToolName(COPILOT_TOOL_TABLE, name),
		name,
		paths: [...paths].sort(),
		...(command === undefined ? {} : { command }),
		...(query === undefined ? {} : { query }),
	});
}

// SPEC §4.5.8 EC-6: disableAllHooks in a hooks file is tamper the L3/L4
// drift check reports (phase 9.5). At the parse layer a tool-less pre-tool
// payload still parses to a marker, so the event is recorded, never dropped.
export function parseCopilotEvent(
	event: string,
	raw: unknown,
): Result<HookEvent> {
	if (!isRecord(raw)) {
		return err(blockError("expected a JSON object"));
	}
	const nativeName = readString(raw, ["hook", "event", "eventName"]);
	const trigger =
		mapCopilotEvent(event) ??
		(nativeName === undefined ? undefined : mapCopilotEvent(nativeName));
	if (trigger === undefined) {
		return err(blockError("unknown event"));
	}
	const sessionId = readString(raw, ["sessionId", "sessionID", "session_id"]);
	if (sessionId === undefined) {
		return err(blockError("missing session id"));
	}
	const cwd = readString(raw, ["cwd", "directory"]);
	if (cwd === undefined) {
		return err(blockError("missing cwd"));
	}
	if (trigger === "pre-tool" || trigger === "post-tool") {
		const tool = readCopilotTool(raw);
		if (!tool.ok) {
			return ok({
				harness: "copilot",
				event: nativeName ?? event,
				trigger,
				sessionId,
				cwd,
			});
		}
		return ok({
			harness: "copilot",
			event: nativeName ?? event,
			trigger,
			sessionId,
			cwd,
			tool: tool.value,
		});
	}
	return ok({
		harness: "copilot",
		event: nativeName ?? event,
		trigger,
		sessionId,
		cwd,
	});
}

// SPEC §4.5.4 Copilot row: stdout carries the permissionDecision deny form
// plus exit 2. Timeouts fail open, so the runtime budget (§4.5.5) emits this
// deny before timeoutSec trips (EC-5).
export function replyCopilot(decision: HookDecision): HookReply {
	if (decision.decision === "block" || decision.decision === "escalate") {
		const reason = decision.message ?? "blocked";
		return {
			exitCode: 2,
			stdout: JSON.stringify({
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			}),
			stderr: reason,
		};
	}
	return { exitCode: 0, stdout: "", stderr: "" };
}

export function staticBlockCopilot(code: string, message: string): HookReply {
	return replyCopilot({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

function copilotHookCommand(event: string): string {
	return `node .codictator/bin/run.mjs hook copilot ${event}`;
}

const COPILOT_HOOK_EVENTS: ReadonlyArray<string> = [
	"postToolUse",
	"preToolUse",
	"sessionStart",
	"userPromptSubmitted",
];

function renderCopilotHooks(): string {
	return stableStringify({
		version: 1,
		hooks: COPILOT_HOOK_EVENTS.map((event) => ({
			event,
			type: "command",
			bash: copilotHookCommand(event),
			powershell: copilotHookCommand(event),
			cwd: ".",
			timeoutSec: COPILOT_TIMEOUT_SEC,
		})),
	});
}

const COPILOT_INSTRUCTIONS = `Follow AGENTS.md at the repository root.
`;

function renderCopilot(_input: RenderInput): Array<FileArtifact> {
	return [
		{ path: ".github/hooks/codictator.json", content: renderCopilotHooks() },
		{
			path: ".github/copilot-instructions.md",
			content: COPILOT_INSTRUCTIONS,
		},
	];
}

export const copilotAdapter: Adapter = {
	id: "copilot",
	capabilities: COPILOT_CAPABILITIES,
	render: renderCopilot,
	parse: parseCopilotEvent,
	reply: replyCopilot,
	staticBlock: staticBlockCopilot,
};
