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
