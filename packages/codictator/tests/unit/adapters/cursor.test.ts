// SPEC §4.5.8: the Cursor adapter (P1) contract. Parse rows assert the
// normalised HookEvent; reply rows assert the harness-native HookReply.
// parseEvent and renderReply dispatch to the Cursor adapter, so every row
// runs green once the 12.5 implementation lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import { handleAdapter } from "../../../src/cli/packs.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { cursorAdapter } from "../../../src/features/adapters/cursor.ts";
import type {
	HookDecision,
	HookEvent,
	RenderInput,
} from "../../../src/features/adapters/index.ts";
import {
	parseEvent,
	renderReply,
	staticBlock,
} from "../../../src/features/adapters/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function blockDecision(message: string): HookDecision {
	return {
		decision: "block",
		message,
		eventId: "01JDTESTEVENT00000000000000",
	};
}

function allowDecision(): HookDecision {
	return { decision: "allow", eventId: "01JDTESTEVENT00000000000001" };
}

function adviseDecision(message: string): HookDecision {
	return {
		decision: "advise",
		message,
		eventId: "01JDTESTEVENT00000000000002",
	};
}

function req(args: ReadonlyArray<string>, cwd: string): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

test("[§4.5 EC-1] cursor payload missing the tool name", () => {
	// SPEC §4.5.8 EC-1: CDX-E303 and block; the raw shape is logged redacted.
	const parsed = parseEvent("cursor", "preToolUse", {
		sessionId: "s-1",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E303");
	}
});

test("[§4.5 EC-2] cursor unknown tool name maps to other", () => {
	// SPEC §4.5.8 EC-2: kind other; tool.pre.other rules still see it.
	const parsed = parseEvent("cursor", "preToolUse", {
		sessionId: "s-1",
		cwd: "/repo",
		tool: { name: "frobnicator" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.tool?.kind, "other");
	}
});

test("[§4.5 EC-10] cursor block shares the engine message text", () => {
	// SPEC §4.5.8 EC-10: identical message text from both harnesses (one engine).
	const cursor = renderReply("cursor", blockDecision("blocked by core/x"));
	assert.ok(cursor.stdout.includes("deny"));
	assert.ok(cursor.stdout.includes("blocked by core/x"));
	const copilot = renderReply("copilot", blockDecision("blocked by core/x"));
	assert.ok(copilot.stdout.includes("blocked by core/x"));
});

test("[§4.5 EC-12] cursor regenerate with no config change", () => {
	// SPEC §4.5.8 EC-12: render twice from the same input → byte-identical
	// artifacts. cursorAdapter also rides the shared EC-12 adapter loop in
	// adapters.test.ts.
	const event: HookEvent = {
		harness: "cursor",
		event: "preToolUse",
		trigger: "pre-tool",
		sessionId: "s-regen",
		cwd: "/repo",
		tool: { kind: "shell", name: "exec", paths: [], command: "npm test" },
	};
	const input: RenderInput = {
		event,
		decision: {
			decision: "allow",
			eventId: "01JDTESTEVENT00000000000012",
		},
	};
	const first = cursorAdapter.render(input);
	const second = cursorAdapter.render(input);
	assert.deepEqual(second, first);
});

test("[§4.5.7] cursor sessionStart parses to session.start", () => {
	// SPEC §4.5.3: the Cursor sessionStart event feeds the startup trigger.
	const parsed = parseEvent("cursor", "sessionStart", {
		sessionId: "s-1",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "startup");
		assert.equal(parsed.value.sessionId, "s-1");
	}
});

test("[§4.5.7] cursor beforeSubmitPrompt parses to prompt.submit", () => {
	// SPEC §4.5.3: the Cursor beforeSubmitPrompt event feeds the prompt trigger.
	const parsed = parseEvent("cursor", "beforeSubmitPrompt", {
		sessionId: "s-2",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "prompt");
		assert.equal(parsed.value.sessionId, "s-2");
	}
});

test("[§4.5.7] cursor preToolUse parses a shell tool call", () => {
	// SPEC §4.5.3: preToolUse carries the tool table; exec is shell.
	const parsed = parseEvent("cursor", "preToolUse", {
		sessionId: "s-3",
		cwd: "/repo",
		tool: { name: "exec", command: "npm test" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "pre-tool");
		assert.equal(parsed.value.tool?.kind, "shell");
	}
});

test("[§4.5.7] cursor beforeShellExecution parses to tool.pre.shell", () => {
	// SPEC §4.5.3: beforeShellExecution is the native shell gate.
	const parsed = parseEvent("cursor", "beforeShellExecution", {
		sessionId: "s-4",
		cwd: "/repo",
		tool: { name: "shell", command: "npm test" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "pre-tool");
		assert.equal(parsed.value.tool?.kind, "shell");
	}
});

test("[§4.5.7] cursor beforeReadFile parses to tool.pre.read", () => {
	// SPEC §4.5.3: beforeReadFile is the native read gate.
	const parsed = parseEvent("cursor", "beforeReadFile", {
		sessionId: "s-5",
		cwd: "/repo",
		tool: { name: "read", filePath: "/repo/a.ts" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "pre-tool");
		assert.equal(parsed.value.tool?.kind, "read");
	}
});

test("[§4.5.7] cursor beforeMCPExecution parses to tool.pre.mcp", () => {
	// SPEC §4.5.3: beforeMCPExecution is the native MCP gate.
	const parsed = parseEvent("cursor", "beforeMCPExecution", {
		sessionId: "s-6",
		cwd: "/repo",
		tool: { name: "mcp__fetch__fetch" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "pre-tool");
		assert.equal(parsed.value.tool?.kind, "mcp");
	}
});

test("[§4.5.7] cursor allow maps to the native allow form", () => {
	// SPEC §4.5.4 Cursor row: only the deny form is pinned; allow never
	// carries a deny.
	const reply = renderReply("cursor", allowDecision());
	assert.equal(reply.exitCode, 0);
	assert.ok(!reply.stdout.includes("deny"));
});

test("[§4.5.7] cursor advise collapses to allow", () => {
	// SPEC §4.5.4 Cursor row: no advise form, so advise carries no message.
	const advised = renderReply(
		"cursor",
		adviseDecision("consider pinning this dep"),
	);
	const allowed = renderReply("cursor", allowDecision());
	assert.deepEqual(advised, allowed);
});

test("[§4.5.7] cursor staticBlock speaks CDX-E002", () => {
	// SPEC §4.5.1: the pre-engine deny in the harness's own deny form.
	const blocked = staticBlock("cursor", "CDX-E002", "no engine");
	assert.ok(blocked !== undefined);
	assert.ok(blocked.stdout.includes("CDX-E002"));
	assert.ok(blocked.stdout.includes("deny"));
});

test("[§4.5.7] cursor staticBlock speaks CDX-E003", () => {
	// SPEC §4.5.1: the pre-engine deny in the harness's own deny form.
	const blocked = staticBlock("cursor", "CDX-E003", "no engine");
	assert.ok(blocked !== undefined);
	assert.ok(blocked.stdout.includes("CDX-E003"));
	assert.ok(blocked.stdout.includes("deny"));
});

test("[§4.5.7] cursor render owns hooks.json and AGENTS.md", () => {
	// SPEC §4.5.4 Cursor row: .cursor/hooks.json plus the native AGENTS.md.
	const event: HookEvent = {
		harness: "cursor",
		event: "preToolUse",
		trigger: "pre-tool",
		sessionId: "s-render",
		cwd: "/repo",
		tool: { kind: "shell", name: "exec", paths: [], command: "npm test" },
	};
	const artifacts = cursorAdapter.render({
		event,
		decision: {
			decision: "allow",
			eventId: "01JDTESTEVENT00000000000013",
		},
	});
	const paths = artifacts.map((artifact) => artifact.path).sort();
	assert.ok(paths.includes(".cursor/hooks.json"));
	assert.ok(paths.includes("AGENTS.md"));
});

test("[§4.5.7] adapter test cursor prints the capability declaration", async () => {
	// SPEC §4.5.7: adapter test prints the declaration (layers and gaps).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "cursor"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});
