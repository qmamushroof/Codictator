// SPEC §4.5.8: the Gemini CLI adapter (P1) contract. Parse rows assert the
// normalised HookEvent; reply rows assert the harness-native HookReply.
// parseEvent, renderReply and staticBlock still throw "not implemented" for
// gemini-cli, so every row fails red until the 12.6 implementation lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import { handleAdapter } from "../../../src/cli/packs.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { geminiCliAdapter } from "../../../src/features/adapters/gemini-cli.ts";
import type {
	HookDecision,
	HookEvent,
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

test("[§4.5 EC-1] gemini payload missing the tool name", () => {
	// SPEC §4.5.8 EC-1: CDX-E303 and block; the raw shape is logged redacted.
	const parsed = parseEvent("gemini-cli", "BeforeTool", {
		sessionId: "s-1",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E303");
	}
});

test("[§4.5 EC-2] gemini unknown tool name maps to other", () => {
	// SPEC §4.5.8 EC-2: kind other; tool.pre.other rules still see it.
	const parsed = parseEvent("gemini-cli", "BeforeTool", {
		sessionId: "s-1",
		cwd: "/repo",
		tool: { name: "frobnicator" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.tool?.kind, "other");
	}
});

test("[§4.5 EC-10] gemini block shares the engine message text", () => {
	// SPEC §4.5.8 EC-10: identical message text from both harnesses (one engine).
	const gemini = renderReply("gemini-cli", blockDecision("blocked by core/x"));
	assert.equal(gemini.exitCode, 2);
	assert.ok(gemini.stdout.includes("deny"));
	assert.ok(gemini.stdout.includes("blocked by core/x"));
	const codex = renderReply("codex-cli", blockDecision("blocked by core/x"));
	assert.ok(codex.stdout.includes("blocked by core/x"));
});

test("[§4.5.7] gemini SessionStart parses to session.start", () => {
	// SPEC §4.5.3: the Gemini SessionStart event feeds the startup trigger.
	const parsed = parseEvent("gemini-cli", "SessionStart", {
		sessionId: "s-1",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "startup");
		assert.equal(parsed.value.sessionId, "s-1");
	}
});

test("[§4.5.7] gemini BeforeAgent parses to prompt.submit", () => {
	// SPEC §4.5.3: the Gemini BeforeAgent event feeds the prompt trigger.
	const parsed = parseEvent("gemini-cli", "BeforeAgent", {
		sessionId: "s-2",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "prompt");
		assert.equal(parsed.value.sessionId, "s-2");
	}
});

test("[§4.5.7] gemini BeforeTool parses a write tool call", () => {
	// SPEC §4.5.3: BeforeTool carries the tool table; write is write.
	const parsed = parseEvent("gemini-cli", "BeforeTool", {
		sessionId: "s-3",
		cwd: "/repo",
		tool: { name: "write", filePath: "/repo/src/index.ts" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "pre-tool");
		assert.equal(parsed.value.tool?.kind, "write");
	}
});

test("[§4.5.7] gemini BeforeTool maps shell and read tool names", () => {
	// SPEC §4.5.3: the per-adapter table maps shell and read names by kind.
	const shelled = parseEvent("gemini-cli", "BeforeTool", {
		sessionId: "s-4",
		cwd: "/repo",
		tool: { name: "exec", command: "npm test" },
	});
	assert.equal(shelled.ok, true);
	if (shelled.ok) {
		assert.equal(shelled.value.trigger, "pre-tool");
		assert.equal(shelled.value.tool?.kind, "shell");
	}
	const read = parseEvent("gemini-cli", "BeforeTool", {
		sessionId: "s-5",
		cwd: "/repo",
		tool: { name: "read", filePath: "/repo/a.ts" },
	});
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.equal(read.value.trigger, "pre-tool");
		assert.equal(read.value.tool?.kind, "read");
	}
});

test("[§4.5.7] gemini AfterTool parses to tool.post.write", () => {
	// SPEC §4.5.3: the Gemini AfterTool event feeds the post-tool trigger.
	const parsed = parseEvent("gemini-cli", "AfterTool", {
		sessionId: "s-6",
		cwd: "/repo",
		tool: { name: "write", filePath: "/repo/src/index.ts" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "post-tool");
		assert.equal(parsed.value.tool?.kind, "write");
	}
});

test("[§4.5.7] gemini AfterAgent parses to post-tool", () => {
	// SPEC §4.5.3: the Gemini AfterAgent event feeds the post-tool trigger.
	const parsed = parseEvent("gemini-cli", "AfterAgent", {
		sessionId: "s-7",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.trigger, "post-tool");
		assert.equal(parsed.value.sessionId, "s-7");
	}
});

test("[§4.5.7] gemini allow maps to the allow form", () => {
	// SPEC §4.5.4 Gemini CLI row: only the deny form is pinned; allow never
	// carries a deny.
	const reply = renderReply("gemini-cli", allowDecision());
	assert.equal(reply.exitCode, 0);
	assert.ok(!reply.stdout.includes("deny"));
});

test("[§4.5.7] gemini staticBlock speaks CDX-E002", () => {
	// SPEC §4.5.1: the pre-engine deny in the harness's own deny form.
	const blocked = staticBlock("gemini-cli", "CDX-E002", "no engine");
	assert.ok(blocked !== undefined);
	assert.ok(blocked.stdout.includes("CDX-E002"));
	assert.ok(blocked.stdout.includes("deny"));
});

test("[§4.5.7] gemini staticBlock speaks CDX-E003", () => {
	// SPEC §4.5.1: the pre-engine deny in the harness's own deny form.
	const blocked = staticBlock("gemini-cli", "CDX-E003", "no engine");
	assert.ok(blocked !== undefined);
	assert.ok(blocked.stdout.includes("CDX-E003"));
	assert.ok(blocked.stdout.includes("deny"));
});

test("[§4.5.7] gemini render owns settings.json and AGENTS.md", () => {
	// SPEC §4.5.4 Gemini CLI row: .gemini/settings.json plus the native AGENTS.md.
	const event: HookEvent = {
		harness: "gemini-cli",
		event: "BeforeTool",
		trigger: "pre-tool",
		sessionId: "s-render",
		cwd: "/repo",
		tool: { kind: "shell", name: "exec", paths: [], command: "npm test" },
	};
	const artifacts = geminiCliAdapter.render({
		event,
		decision: {
			decision: "allow",
			eventId: "01JDTESTEVENT00000000000013",
		},
	});
	const paths = artifacts.map((artifact) => artifact.path).sort();
	assert.ok(paths.includes(".gemini/settings.json"));
	assert.ok(paths.includes("AGENTS.md"));
});

test("[§4.5.7] adapter test gemini prints the capability declaration", async () => {
	// SPEC §4.5.7: adapter test prints the declaration (layers and gaps).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "gemini-cli"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});
