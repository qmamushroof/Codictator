// SPEC §4.20.1 Engine: the filesystem port behind configExists and
// engineExists. Production passes node:fs existsSync from the extension
// entry; unit tests pass a fake or omit it, so nothing touches the real
// filesystem under node:test. The extension stays dependency-free by
// taking this port as a parameter instead of importing node:fs itself.
export interface ExtensionHostFs {
	exists(path: string): boolean;
}

// SPEC §4.20.1 Activation + Engine: the per-folder paths. The config path
// matches the workspaceContains activation event; the engine path is the
// run.mjs the Engine row spawns per folder that has a config.
export function configPathFor(folderPath: string): string {
	return `${folderPath}/.codictator/config.json`;
}

export function enginePathFor(folderPath: string): string {
	return `${folderPath}/.codictator/bin/run.mjs`;
}

// A throwing or missing fs reads as absent: without a config no server
// spawns, and without an engine the missing-engine notification owns the
// folder, so false is the closed direction.
export function existsFile(
	fs: ExtensionHostFs | undefined,
	path: string,
): boolean {
	if (fs === undefined) {
		return false;
	}
	try {
		return fs.exists(path);
	} catch {
		return false;
	}
}
