// SPEC §4.7: hookScope strips targets against the raw root spelling when
// the canonical root differs (macOS /var vs /private/var). Synthetic
// roots only — no disk, no symlinks — so this passes headless everywhere.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { HookEvent } from "../../../src/features/adapters/contract.ts";
import { hookScope } from "../../../src/features/adapters/hook-scope.ts";

function eventFor(target: string): HookEvent {
	return {
		harness: "muse-code",
		event: "PreToolUse",
		trigger: "pre-tool",
		sessionId: "session-1",
		cwd: "/var/folders/xyz/repo",
		tool: { kind: "write", name: "write", paths: [target] },
	};
}

test("[§4.7] hookScope relativizes targets against the raw root spelling when the canonical root differs", () => {
	const raw = "/var/folders/xyz/repo";
	const canonical = "/private/var/folders/xyz/repo";
	const scope = hookScope(
		eventFor("/var/folders/xyz/repo/src/a.ts"),
		canonical,
		raw,
	);
	assert.deepEqual(scope.proposedPaths, ["src/a.ts"]);
});

test("[§4.7] hookScope keeps single-root behavior when spellings are equal", () => {
	const scope = hookScope(eventFor("/repo/src/a.ts"), "/repo", "/repo");
	assert.deepEqual(scope.proposedPaths, ["src/a.ts"]);
});
