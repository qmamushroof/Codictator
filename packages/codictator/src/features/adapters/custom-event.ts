// SPEC §4.5.6: custom hook payload narrowing. Turns the adapter's open
// payload into the closed HookEvent the engine matches enforcers against,
// and remaps the native trigger onto the closed Trigger union (first-party
// precedent is mapClaudeEvent). Builds on the shared primitives in
// custom-shape.ts; the loader imports narrowEvent from here.
import type { Result } from "../../kernel/index.ts";
import { err, ok } from "../../kernel/index.ts";
import type { Trigger } from "../engine/index.ts";
import type { HookEvent, HookToolCall, ToolKind } from "./contract.ts";
import { failParse, field, isRecord } from "./custom-shape.ts";

const TOOL_KINDS = [
	"write",
	"shell",
	"read",
	"search",
	"web",
	"mcp",
	"task",
	"other",
] as const;

function narrowToolKind(value: unknown): ToolKind | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	// TOOL_KINDS is the contract's closed set, so the found string is one.
	return TOOL_KINDS.find((kind) => kind === value);
}

function readPaths(value: unknown): Array<string> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const paths: Array<string> = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			return undefined;
		}
		paths.push(entry);
	}
	return paths;
}

function readOptionalText(
	record: Record<string, unknown>,
	key: string,
): Result<string | undefined> {
	const text = field(record, key);
	if (text === undefined) {
		return ok(undefined);
	}
	if (typeof text !== "string") {
		return err(failParse(`tool ${key} must be a string`));
	}
	return ok(text);
}

function narrowToolHead(
	value: Record<string, unknown>,
): Result<{ kind: ToolKind; name: string; paths: Array<string> }> {
	const kind = narrowToolKind(field(value, "kind"));
	const name = field(value, "name");
	const paths = readPaths(field(value, "paths"));
	if (kind === undefined || typeof name !== "string" || name === "") {
		return err(failParse("tool needs a known kind and a name"));
	}
	if (paths === undefined) {
		return err(failParse("tool needs a paths array"));
	}
	return ok({ kind, name, paths });
}

function narrowToolOptionals(value: Record<string, unknown>): Result<{
	readonly command?: string;
	readonly proposedContent?: string;
	readonly query?: string;
}> {
	const command = readOptionalText(value, "command");
	if (!command.ok) {
		return err(command.error);
	}
	const proposed = readOptionalText(value, "proposedContent");
	if (!proposed.ok) {
		return err(proposed.error);
	}
	const query = readOptionalText(value, "query");
	if (!query.ok) {
		return err(query.error);
	}
	return ok({
		...(command.value === undefined ? {} : { command: command.value }),
		...(proposed.value === undefined
			? {}
			: { proposedContent: proposed.value }),
		...(query.value === undefined ? {} : { query: query.value }),
	});
}

function narrowTool(value: unknown): Result<HookToolCall> {
	if (!isRecord(value)) {
		return err(failParse("tool must be an object"));
	}
	const head = narrowToolHead(value);
	if (!head.ok) {
		return err(head.error);
	}
	const optionals = narrowToolOptionals(value);
	if (!optionals.ok) {
		return err(optionals.error);
	}
	return ok({
		kind: head.value.kind,
		name: head.value.name,
		paths: [...head.value.paths].sort(),
		...optionals.value,
	});
}

// SPEC §4.5.6 + §7.8: the native name stays in the open `event` string,
// but `trigger` is the closed Trigger union the engine matches enforcers
// against (evaluate.ts TRIGGER_LAYERS). A verbatim native trigger would
// match zero enforcers and fail open to allow, so the seam remaps here —
// first-party precedent is mapClaudeEvent — and an unknown native
// trigger fails closed with CDX-E303.
const CUSTOM_TRIGGER_TABLE: Readonly<Record<string, Trigger>> = {
	"tool.pre.write": "pre-tool",
	"tool.pre.shell": "pre-tool",
	"tool.pre.read": "pre-tool",
	"tool.pre.search": "pre-tool",
	"tool.pre.other": "pre-tool",
	"pre-tool": "pre-tool",
	"tool.post.write": "post-tool",
	"post-tool": "post-tool",
	"session.start": "startup",
	startup: "startup",
	"prompt.submit": "prompt",
	prompt: "prompt",
	"compact.post": "compact",
	compact: "compact",
	review: "review",
	scheduled: "scheduled",
};

function mapCustomTrigger(native: string): Trigger | undefined {
	return CUSTOM_TRIGGER_TABLE[native];
}

function readEventField(
	value: Record<string, unknown>,
	key: string,
	label: string,
): Result<string> {
	const found = field(value, key);
	if (typeof found !== "string" || found === "") {
		return err(failParse(label));
	}
	return ok(found);
}

function narrowEventScalars(
	fullId: string,
	value: Record<string, unknown>,
): Result<{ event: string; trigger: Trigger; sessionId: string; cwd: string }> {
	if (field(value, "harness") !== fullId) {
		return err(failParse("harness mismatch"));
	}
	const event = readEventField(value, "event", "missing event name");
	if (!event.ok) {
		return err(event.error);
	}
	const trigger = readEventField(value, "trigger", "missing trigger");
	if (!trigger.ok) {
		return err(trigger.error);
	}
	const sessionId = readEventField(value, "sessionId", "missing session id");
	if (!sessionId.ok) {
		return err(sessionId.error);
	}
	const cwd = readEventField(value, "cwd", "missing cwd");
	if (!cwd.ok) {
		return err(cwd.error);
	}
	// SPEC §4.5.6 + §7.8: the native name stays in the open `event` string,
	// but `trigger` is the closed Trigger union, so remap the native
	// trigger and fail closed on an unknown one (never pass it verbatim).
	const mapped = mapCustomTrigger(trigger.value);
	if (mapped === undefined) {
		return err(failParse("unknown trigger"));
	}
	return ok({
		event: event.value,
		trigger: mapped,
		sessionId: sessionId.value,
		cwd: cwd.value,
	});
}

export function narrowEvent(fullId: string, value: unknown): Result<HookEvent> {
	if (!isRecord(value)) {
		return err(failParse("expected a JSON object"));
	}
	const scalars = narrowEventScalars(fullId, value);
	if (!scalars.ok) {
		return err(scalars.error);
	}
	const toolField = field(value, "tool");
	if (toolField === undefined) {
		return ok({ harness: fullId, ...scalars.value });
	}
	const narrowed = narrowTool(toolField);
	if (!narrowed.ok) {
		return err(narrowed.error);
	}
	return ok({ harness: fullId, ...scalars.value, tool: narrowed.value });
}
