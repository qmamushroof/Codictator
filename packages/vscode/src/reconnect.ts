// SPEC §4.20.4: restart and reconnect behaviour for step 11.5. Red-first:
// every entry throws until the reconnect phase implements it.
export function reconnectBackoffMs(): ReadonlyArray<number> {
	throw new Error("not implemented: SPEC §4.20 EC-2");
}

// SPEC §4.20 EC-3: the server restarts when package-lock.json or the tool
// lock changes under it; anything else leaves the server alone.
export function shouldRestartOnLockChange(_changedPath: string): boolean {
	throw new Error("not implemented: SPEC §4.20 EC-3");
}

// SPEC §4.20 EC-4: an untrusted workspace keeps the extension inactive behind
// the VS Code trust prompt.
export function isActiveInUntrustedWorkspace(): boolean {
	throw new Error("not implemented: SPEC §4.20 EC-4");
}

// SPEC §4.20 EC-6: Cursor rides the VS Code 1.105 base, so the extension
// uses no API newer than 1.105 (types pinned to 1.105.0).
export function apiFloorVersion(): string {
	throw new Error("not implemented: SPEC §4.20 EC-6");
}
