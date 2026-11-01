// SPEC §4.20.4: restart and reconnect behaviour for step 11.5. EC-2: a
// crashed server restarts with backoff (1 s, 5 s, 30 s); the views show
// "disconnected" meanwhile (the "disconnected" text lives in the view
// layer; this module owns the delay schedule).
export function reconnectBackoffMs(): ReadonlyArray<number> {
	return [1000, 5000, 30000];
}

// SPEC §4.20 EC-3: the server restarts when package-lock.json or the tool
// lock changes under it; anything else leaves the server alone. The tool
// install is `.codictator/tool/package.json` + `package-lock.json`
// (§4.19.2), so any changed path whose basename is `package-lock.json`
// covers both the root lock and the tool lock.
export function shouldRestartOnLockChange(changedPath: string): boolean {
	const normalized = changedPath.replace(/\\/g, "/");
	const base = normalized.split("/").pop() ?? "";
	return base === "package-lock.json";
}

// SPEC §4.20 EC-4: an untrusted workspace keeps the extension inactive behind
// the VS Code trust prompt. Mirrors `untrustedWorkspaceSupport()` in
// main.ts and `capabilities.untrustedWorkspaces.supported: false` in
// package.json (§4.20.1 Trust): the extension executes the repo engine, so
// it never activates untrusted.
export function isActiveInUntrustedWorkspace(): boolean {
	return false;
}

// SPEC §4.20 EC-6: Cursor rides the VS Code 1.105 base, so the extension
// uses no API newer than 1.105 (types pinned to 1.105.0). Matches
// `engines.vscode: ^1.105.0` in package.json.
export function apiFloorVersion(): string {
	return "1.105.0";
}
