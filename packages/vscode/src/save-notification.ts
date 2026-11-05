// SPEC §4.20.2 L2 on save: the save-notification seam. The host save event
// narrows to the view SaveEvent: the document reads through its uri fsPath
// and resolves to the longest matching workspace folder; anything else
// skips the listener. The seam is optional, so a host without the
// notification contributes nothing instead of an explicit undefined.
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
		if (fsPath !== folder && !fsPath.startsWith(`${folder}/`)) {
			continue;
		}
		const rest = fsPath === folder ? "" : fsPath.slice(folder.length + 1);
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
