// SPEC §4.20 EC-11 paths: save-notification regression pins. Windows
// fsPaths resolve through separators with the longest match winning, and
// malformed documents stay silent instead of throwing.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	isInside,
	onDidSaveOf,
	samePath,
} from "../../src/save-notification.ts";
import type { SaveEvent } from "../../src/views.ts";

// Narrowing-free harness: the host carries one save subscriber, and fire
// replays a raw document the way the host save seam narrows it.
function subscribeFolders(folders: ReadonlyArray<string>): {
	events: Array<SaveEvent>;
	fire(document: unknown): void;
} {
	const events: Array<SaveEvent> = [];
	let fire: (document: unknown) => void = () => undefined;
	const host = {
		workspace: {
			onDidSaveTextDocument: (
				listener: (document: unknown) => void,
			): unknown => {
				fire = listener;
				return { dispose: (): void => undefined };
			},
		},
	};
	const subscribe = onDidSaveOf(host, () => folders);
	assert.ok(subscribe !== undefined);
	const disposable = subscribe((event) => {
		events.push(event);
	});
	assert.ok(disposable !== undefined);
	return {
		events,
		fire: (document: unknown): void => {
			fire(document);
		},
	};
}

test("[§4.20 EC-11] Windows fsPath saves resolve inside the folder", () => {
	// SPEC §4.20 EC-11: backslash fsPaths resolve through separators, so a
	// Windows save lands on its folder with a forward-slashed file path.
	const save = subscribeFolders(["C:\\repo"]);
	save.fire({ uri: { fsPath: "C:\\repo\\src\\a.ts" } });
	assert.deepEqual(save.events, [
		{ folderPath: "C:\\repo", filePath: "src/a.ts" },
	]);
});

test("[§4.20 EC-11] saves outside every folder stay silent and nest to the longest match", () => {
	// SPEC §4.20 EC-11: a save outside every folder and a save of the
	// folder itself stay silent; a nested save picks the longest folder.
	const save = subscribeFolders(["C:\\repo", "C:\\repo\\packages"]);
	save.fire({ uri: { fsPath: "C:\\other\\a.ts" } });
	save.fire({ uri: { fsPath: "C:\\repo" } });
	assert.deepEqual(save.events, []);
	save.fire({ uri: { fsPath: "C:\\repo\\packages\\vscode\\x.ts" } });
	assert.deepEqual(save.events, [
		{ folderPath: "C:\\repo\\packages", filePath: "vscode/x.ts" },
	]);
});

test("[§4.20 EC-11] samePath normalizes separators before comparing", () => {
	// SPEC §4.20 EC-11: separator spellings of one path compare equal, a
	// different path does not, and equality stays case-sensitive off win32.
	assert.equal(samePath("C:\\repo", "C:/repo"), true);
	assert.equal(samePath("C:\\repo", "C:\\other"), false);
	assert.equal(samePath("/repo", "/repo/sub"), false);
});

test("[§4.20 EC-11] isInside rejects equality and parent escapes", () => {
	// SPEC §4.20 EC-11: containment is relative-based, so the folder itself
	// is not inside, a ".." escape is outside, and a nested file is inside.
	assert.equal(isInside("C:\\repo", "C:\\repo"), false);
	assert.equal(isInside("C:\\repo", "C:\\repo\\sub\\a.ts"), true);
	assert.equal(isInside("C:\\repo", "C:\\repo\\..\\other\\a.ts"), false);
	assert.equal(isInside("/repo", "/other/a.ts"), false);
});

test("[§4.20.2] malformed save documents stay silent", () => {
	// SPEC §4.20.2 L2 on save: a document without a usable fsPath or a
	// host without the save seam contributes nothing instead of throwing.
	const save = subscribeFolders(["C:\\repo"]);
	save.fire(undefined);
	save.fire(null);
	save.fire({ uri: undefined });
	save.fire({ uri: { fsPath: 42 } });
	save.fire({ uri: { fsPath: "" } });
	assert.deepEqual(save.events, []);
	assert.equal(
		onDidSaveOf({}, () => []),
		undefined,
	);
	assert.equal(
		onDidSaveOf({ workspace: {} }, () => []),
		undefined,
	);
	const throwing = {
		workspace: {
			onDidSaveTextDocument: (): unknown => {
				throw new Error("no subscription");
			},
		},
	};
	assert.equal(
		onDidSaveOf(throwing, () => [])?.(() => undefined),
		undefined,
	);
});
