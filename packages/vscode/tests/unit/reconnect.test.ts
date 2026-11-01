// SPEC §4.20.4: restart and reconnect behaviour, untrusted workspaces and
// the Cursor-compatible API floor. Each test pins one edge case against the
// reconnect entry, which still throws "not implemented", so all four fail
// red until step 11.5 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	apiFloorVersion,
	isActiveInUntrustedWorkspace,
	reconnectBackoffMs,
	shouldRestartOnLockChange,
} from "../../src/main.ts";

test("[§4.20 EC-2] crashed server restarts with backoff while views show disconnected", () => {
	// SPEC §4.20 EC-2: a crashed server restarts with backoff (1 s, 5 s,
	// 30 s); the views show "disconnected" meanwhile.
	assert.deepEqual(reconnectBackoffMs(), [1000, 5000, 30000]);
});

test("[§4.20 EC-3] engine version change restarts the server", () => {
	// SPEC §4.20 EC-3: the server restarts on a package-lock.json or
	// tool-lock change; an unrelated file leaves it alone.
	assert.equal(shouldRestartOnLockChange("package-lock.json"), true);
	assert.equal(shouldRestartOnLockChange("src/index.ts"), false);
});

test("[§4.20 EC-4] untrusted workspace keeps the extension inactive", () => {
	// SPEC §4.20 EC-4: in an untrusted workspace the extension stays
	// inactive behind the VS Code trust prompt.
	assert.equal(isActiveInUntrustedWorkspace(), false);
});

test("[§4.20 EC-6] Cursor API floor uses no API newer than 1.105", () => {
	// SPEC §4.20 EC-6: Cursor rides the VS Code 1.105 base, so the pinned
	// API floor is 1.105.0.
	assert.equal(apiFloorVersion(), "1.105.0");
});
