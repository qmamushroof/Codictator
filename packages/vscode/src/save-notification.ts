// SPEC §4.20.2 L2 on save: the save-notification seam. The host save event
// narrows to the view SaveEvent: the document reads through its uri fsPath
// and resolves to the longest matching workspace folder; anything else
// skips the listener. The seam is optional, so a host without the
// notification contributes nothing instead of an explicit undefined.
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fieldOf, isRecord } from "./engine-client.ts";
import type { ExtensionDisposable } from "./tree-provider.ts";
import { toDisposable } from "./tree-provider.ts";
import type { SaveEvent } from "./views.ts";

// Narrowing: the host object is unknown, so every field narrows through a
// check (CONVENTIONS.md, no `as` widening); one callable guard covers every
// host function slot.
type HostFn = (...args: Array<unknown>) => unknown;

function isHostFn(value: unknown): value is HostFn {
	return typeof value === "function";
}

// SPEC §4.20 EC-11: Windows paths ride backslashes, so every comparison
// normalizes separators first; the helpers stay platform-independent, so
// the unit pins hold on any OS.
function splitPath(value: string): string {
	return value.replace(/\\/g, "/");
}

// SPEC §4.20.1 Engine: the handshake compares initialize.root with the
// folder through this helper, so a case-only or separator-only spelling
// never reads as a foreign root.
export function samePath(left: string, right: string): boolean {
	const resolvedLeft = resolve(splitPath(left));
	const resolvedRight = resolve(splitPath(right));
	if (process.platform === "win32") {
		return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
	}
	return resolvedLeft === resolvedRight;
}

// SPEC §4.20 EC-11: folder containment through path.relative, never a
// string prefix, so Windows fsPaths match and ".." names stay outside.
export function isInside(folder: string, file: string): boolean {
	if (samePath(folder, file)) {
		return false;
	}
	const rest = relative(splitPath(folder), splitPath(file));
	return (
		rest !== "" &&
		rest !== ".." &&
		!rest.startsWith(`..${sep}`) &&
		!isAbsolute(rest)
	);
}

function saveEventOf(
	document: unknown,
	folders: ReadonlyArray<string>,
): SaveEvent | undefined {
	if (!isRecord(document)) {
		return undefined;
	}
	const uri = fieldOf(document, "uri");
	if (!isRecord(uri)) {
		return undefined;
	}
	const fsPath = fieldOf(uri, "fsPath");
	if (typeof fsPath !== "string" || fsPath === "") {
		return undefined;
	}
	let match: { folder: string; rest: string } | undefined;
	for (const folder of folders) {
		if (!isInside(folder, fsPath)) {
			continue;
		}
		const rest = relative(splitPath(folder), splitPath(fsPath))
			.split(sep)
			.join("/");
		if (match === undefined || folder.length > match.folder.length) {
			match = { folder, rest };
		}
	}
	if (match === undefined || match.rest === "") {
		return undefined;
	}
	return { filePath: match.rest, folderPath: match.folder };
}

export function onDidSaveOf(
	host: unknown,
	foldersOf: () => ReadonlyArray<string>,
):
	| ((listener: (event: SaveEvent) => void) => ExtensionDisposable | undefined)
	| undefined {
	const workspace = fieldOf(host, "workspace");
	const subscribe = fieldOf(workspace, "onDidSaveTextDocument");
	if (!isHostFn(subscribe)) {
		return undefined;
	}
	return (
		listener: (event: SaveEvent) => void,
	): ExtensionDisposable | undefined => {
		let result: unknown;
		try {
			result = subscribe((document: unknown) => {
				const event = saveEventOf(document, foldersOf());
				if (event !== undefined) {
					listener(event);
				}
			});
		} catch {
			return undefined;
		}
		return toDisposable(result);
	};
}
