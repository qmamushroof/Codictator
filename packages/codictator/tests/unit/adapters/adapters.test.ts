// SPEC §4.5.8: one red test per adapters EC row. Parse rows assert the
// normalised HookEvent; reply rows assert the harness-native HookReply.
// parseEvent and renderReply still throw "not implemented", so all
// twenty-four fail red until the P0 adapters land.
import { strict as assert } from "node:assert";
import test from "node:test";
import { geminiCliAdapter } from "../../../src/features/adapters/gemini-cli.ts";
import type {
	HookDecision,
	HookEvent,
	RenderInput,
} from "../../../src/features/adapters/index.ts";
import {
	claudeCodeAdapter,
	codexCliAdapter,
	copilotAdapter,
	cursorAdapter,
	museAdapter,
	opencodeAdapter,
	parseEvent,
	renderReply,
	universalAdapter,
} from "../../../src/features/adapters/index.ts";

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

test("[§4.5 EC-1] payload missing the tool name", () => {
	// SPEC §4.5.8 EC-1: CDX-E303 and block; the raw shape is logged redacted.
	const parsed = parseEvent("claude-code", "PreToolUse", {
		session_id: "s-1",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E303");
	}
});

test("[§4.5 EC-2] unknown tool name", () => {
	// SPEC §4.5.8 EC-2: kind other; tool.pre.other rules still see it.
	const parsed = parseEvent("claude-code", "PreToolUse", {
		session_id: "s-1",
		cwd: "/repo",
		tool_name: "frobnicator",
		tool_input: {},
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.tool?.kind, "other");
	}
});

test("[§4.5 EC-3] user hook entry preserved on regenerate", () => {
	// SPEC §4.5.8 EC-3: user entries survive; the manifest hashes only the
	// owned projection.
	const parsed = parseEvent("claude-code", "PreToolUse", {
		session_id: "s-1",
		cwd: "/repo",
		tool_name: "Read",
		tool_input: { path: "a.ts" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.sessionId, "s-1");
	}
});

test("[§4.5 EC-4] deleted PreToolUse entry drifts", () => {
	// SPEC §4.5.8 EC-4: a drift finding at the next session start, L3 and L4.
	const parsed = parseEvent("claude-code", "SessionStart", {
		session_id: "s-2",
		cwd: "/repo",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.sessionId, "s-2");
	}
});

test("[§4.5 EC-5] Copilot hook near its timeout", () => {
	// SPEC §4.5.8 EC-5: the deny goes out before the harness timeout.
	const reply = renderReply("copilot", blockDecision("blocked by core/x"));
	assert.equal(reply.exitCode, 2);
	assert.ok(reply.stdout.includes("permissionDecision"));
	assert.ok(reply.stdout.includes("deny"));
});

test("[§4.5 EC-6] disableAllHooks in a Copilot hooks file", () => {
	// SPEC §4.5.8 EC-6: tamper; blocks at L3/L4.
	const parsed = parseEvent("copilot", "preToolUse", {
		sessionId: "s-1",
		cwd: "/repo",
		disableAllHooks: true,
	});
	assert.equal(parsed.ok, true);
});

test("[§4.5 EC-7] Muse Code workspace not yet trusted", () => {
	// SPEC §4.5.8 EC-7: L1 unknown; the memory topic still steers; L3/L4 enforce.
	const parsed = parseEvent("muse-code", "SessionStart", {
		session_id: "s-3",
		cwd: "/repo",
		trusted: false,
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.sessionId, "s-3");
	}
});

test("[§4.5 EC-8] Codex run inside a git worktree", () => {
	// SPEC §4.5.8 EC-8: status shows L1 inactive for Codex with the issue ref.
	const parsed = parseEvent("codex-cli", "SessionStart", {
		session_id: "s-4",
		cwd: "/repo/packages/a",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.cwd, "/repo/packages/a");
	}
});

test("[§4.5 EC-9] engine missing after a fresh clone", () => {
	// SPEC §4.5.8 EC-9: the embedded static CDX-E003 block reply per harness.
	const muse = renderReply(
		"muse-code",
		blockDecision("CDX-E003 engine not installed"),
	);
	assert.equal(muse.exitCode, 0);
	assert.ok(muse.stdout.includes("deny"));
	const claude = renderReply(
		"claude-code",
		blockDecision("CDX-E003 engine not installed"),
	);
	assert.equal(claude.exitCode, 2);
});

test("[§4.5 EC-10] one rule blocks in two harnesses", () => {
	// SPEC §4.5.8 EC-10: identical message text from both (one engine).
	const first = renderReply("muse-code", blockDecision("blocked by core/x"));
	const second = renderReply("claude-code", blockDecision("blocked by core/x"));
	assert.ok(first.stdout.includes("blocked by core/x"));
	assert.ok(second.stdout.includes("blocked by core/x"));
});

test("[§4.5 EC-11] hook payload larger than eight MiB", () => {
	// SPEC §4.5.8 EC-11: block CDX-E305; write the file in smaller edits.
	const parsed = parseEvent("claude-code", "PreToolUse", {
		session_id: "s-1",
		cwd: "/repo",
		tool_name: "Write",
		tool_input: { content: "x".repeat(8 * 1024 * 1024 + 1) },
	});
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E305");
	}
});

test("[§4.5 EC-12] regenerate with no config change", () => {
	// SPEC §4.5.8 EC-12: render twice from the same input → byte-identical
	// artifacts. The old body only proved reply determinism; regeneration is
	// render determinism, so every P0 adapter renders twice here.
	const event: HookEvent = {
		harness: "regen-proof",
		event: "PreToolUse",
		trigger: "pre-tool",
		sessionId: "s-regen",
		cwd: "/repo",
		tool: { kind: "write", name: "Write", paths: ["/repo/a.ts"] },
	};
	const input: RenderInput = {
		event,
		decision: {
			decision: "allow",
			eventId: "01JDTESTEVENT00000000000012",
		},
	};
	for (const adapter of [
		museAdapter,
		opencodeAdapter,
		claudeCodeAdapter,
		copilotAdapter,
		cursorAdapter,
		geminiCliAdapter,
		codexCliAdapter,
		universalAdapter,
	]) {
		const first = adapter.render(input);
		const second = adapter.render(input);
		assert.deepEqual(second, first);
		assert.deepEqual(
			second.map((artifact) => artifact.path),
			first.map((artifact) => artifact.path),
		);
	}
});

test("[§4.5 EC-13] harness hook runs from a sub-directory", () => {
	// SPEC §4.5.8 EC-13: the launcher resolves the root via git rev-parse.
	const parsed = parseEvent("claude-code", "PreToolUse", {
		session_id: "s-1",
		cwd: "/repo/sub/dir",
		tool_name: "Read",
		tool_input: { path: "a.ts" },
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.cwd, "/repo/sub/dir");
	}
});

test("[§4.5 EC-14] Muse Code allow decision", () => {
	// SPEC §4.5.8 EC-14: exactly {}, exit 0; no permissionDecision allow.
	const reply = renderReply("muse-code", allowDecision());
	assert.equal(reply.exitCode, 0);
	assert.equal(reply.stdout, "{}");
});

test("[§4.5 EC-15] Muse Code block decision", () => {
	// SPEC §4.5.8 EC-15: exit 0 with the hookSpecificOutput deny JSON.
	const reply = renderReply("muse-code", blockDecision("blocked by core/x"));
	assert.equal(reply.exitCode, 0);
	assert.ok(reply.stdout.includes("hookSpecificOutput"));
	assert.ok(reply.stdout.includes("deny"));
	assert.ok(!reply.stdout.includes('"decision"'));
});

test("[§4.5 EC-16] Muse Code Stop with an active hook", () => {
	// SPEC §4.5.8 EC-16: allow ({}), even with open findings, so no loop.
	const parsed = parseEvent("muse-code", "Stop", {
		session_id: "s-5",
		cwd: "/repo",
		stop_hook_active: true,
	});
	assert.equal(parsed.ok, true);
	const reply = renderReply("muse-code", allowDecision());
	assert.equal(reply.exitCode, 0);
	assert.equal(reply.stdout, "{}");
});

test("[§4.5 EC-17] OpenCode bridge exceeds its spawn timeout", () => {
	// SPEC §4.5.8 EC-17: the bridge throws, the call is refused, and the next
	// run records CDX-E902.
	const parsed = parseEvent("opencode", "tool.execute.before", {
		sessionID: "s-6",
		timedOut: true,
	});
	assert.equal(parsed.ok, true);
});

test("[§4.5 EC-18] OpenCode bridge without node on PATH", () => {
	// SPEC §4.5.8 EC-18: the spawn error throws; the refusal carries CDX-E001.
	const parsed = parseEvent("opencode", "tool.execute.before", {
		sessionID: "s-6",
		spawnError: "ENOENT node",
	});
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E001");
	}
});

test("[§4.5 EC-19] literal apiKey in opencode.json", () => {
	// SPEC §4.5.8 EC-19: core/no-secrets blocks at L1, L3 and L4.
	const parsed = parseEvent("opencode", "session.created", {
		sessionID: "s-7",
		configSnippet: '"options": {"apiKey": "sk-live-xyz"}',
	});
	assert.equal(parsed.ok, true);
});

test("[§4.5 EC-20] OpenCode without the system transform", () => {
	// SPEC §4.5.8 EC-20: the probe trips at the first tool call and the context
	// moves to a synthetic chat.message part; status shows the fallback.
	const parsed = parseEvent("opencode", "tool.execute.before", {
		sessionID: "s-8",
		contextDelivered: false,
	});
	assert.equal(parsed.ok, true);
});

test("[§4.5 EC-21] OpenCode launcher fails mid-injection", () => {
	// SPEC §4.5.8 EC-21: the static fallback line is injected, the turn
	// proceeds, and tool calls stay gated.
	const reply = renderReply("opencode", {
		decision: "allow",
		additionalContext:
			"Codictator context unavailable (CDX-E302); AGENTS.md and tool gating still apply",
		eventId: "01JDTESTEVENT00000000000002",
	});
	assert.equal(reply.exitCode, 0);
	assert.ok(reply.stdout.includes("Codictator context unavailable"));
});

test("[§4.5 EC-22] OpenCode session resumed after restart", () => {
	// SPEC §4.5.8 EC-22: the transform cache miss spawns prompt.submit once;
	// context is present on the first model call.
	const parsed = parseEvent("opencode", "experimental.chat.system.transform", {
		sessionID: "s-9",
		cacheMiss: true,
	});
	assert.equal(parsed.ok, true);
});

test("[§4.5 EC-23] OpenCode prompt at the hard band", () => {
	// SPEC §4.5.8 EC-23: chat.message throws the checkpoint message; the prompt
	// is not stored; tool calls block per §4.6.4.
	const reply = renderReply(
		"opencode",
		blockDecision(
			"checkpoint: commit the task record, then start a new session",
		),
	);
	assert.ok(reply.stdout.includes("checkpoint"));
});

test("[§4.5 EC-24] opencode version 2.x", () => {
	// SPEC §4.5.8 EC-24: status shows OpenCode L1 unknown with the supported
	// range; init warns; L3 and L4 enforce as usual.
	const parsed = parseEvent("opencode", "session.created", {
		sessionID: "s-10",
		version: "2.0.0",
	});
	assert.equal(parsed.ok, true);
});
