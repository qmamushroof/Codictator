// SPEC §4.20.2 + §4.20.3: the PR4 commands, header states, settings and
// view-title refresh. Red-first: ux-commands.ts does not exist yet and
// package.json declares none of the contributes rows below.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	notifyOnBlockOf,
	registerUxCommands,
	timelinePageSizeOf,
	type UxCommandPorts,
	uxContextValues,
} from "../../src/ux-commands.ts";

function fakePorts(): {
	calls: Array<string>;
	handlers: Map<string, (...args: Array<unknown>) => unknown>;
	ports: UxCommandPorts;
} {
	const calls: Array<string> = [];
	const handlers = new Map<string, (...args: Array<unknown>) => unknown>();
	return {
		calls,
		handlers,
		ports: {
			createTerminal: (name: string) => {
				calls.push(`terminal:${name}`);
				return {
					sendText: (text: string, execute: boolean): void => {
						calls.push(`send:${execute}:${text}`);
					},
					show: (): void => {
						calls.push("show");
					},
				};
			},
			focusViews: (): void => {
				calls.push("focus");
			},
			loadMore: (cursor: string): void => {
				calls.push(`loadMore:${cursor}`);
			},
			refreshViews: (): void => {
				calls.push("refresh");
			},
			registerCommand: (
				commandId: string,
				handler: (...args: Array<unknown>) => unknown,
			): void => {
				calls.push(`register:${commandId}`);
				handlers.set(commandId, handler);
			},
			restartEngine: (): void => {
				calls.push("restart");
			},
			showLog: (): void => {
				calls.push("showLog");
			},
		},
	};
}

test("[§4.20.3] restart, show log and refresh commands reach their ports", () => {
	// SPEC §4.20.3 PR4: the three commands route to the engine restart, the
	// output channel and the view refresh.
	const { calls, handlers, ports } = fakePorts();
	registerUxCommands(ports);
	for (const command of [
		"codictator.restartEngine",
		"codictator.showLog",
		"codictator.refresh",
	]) {
		assert.ok(calls.includes(`register:${command}`), `registers ${command}`);
	}
	handlers.get("codictator.restartEngine")?.();
	handlers.get("codictator.showLog")?.();
	handlers.get("codictator.refresh")?.();
	assert.ok(calls.includes("restart"));
	assert.ok(calls.includes("showLog"));
	assert.ok(calls.includes("refresh"));
});

test("[§4.20.3] install, baseline and load more commands reach their ports", () => {
	// SPEC §4.20.3 PR4: human-only repairs pre-fill a terminal and run
	// nothing; load more routes its cursor to the refresh port.
	const { calls, handlers, ports } = fakePorts();
	registerUxCommands(ports);
	handlers.get("codictator.installEngine")?.();
	assert.ok(calls.includes("terminal:Codictator Install"));
	assert.ok(calls.includes("send:true:npm ci"));
	handlers.get("codictator.captureBaseline")?.();
	assert.ok(
		calls.includes("send:false:codictator baseline capture"),
		"baseline pre-fills without running",
	);
	handlers.get("codictator.depsCheck")?.();
	assert.ok(calls.includes("send:false:codictator deps check"));
	handlers.get("codictator.timelineLoadMore")?.("cursor-9");
	assert.ok(calls.includes("loadMore:cursor-9"));
	handlers.get("codictator.focusViews")?.();
	assert.ok(calls.includes("focus"));
});

test("[§4.20.2] header state contexts separate setup, missing engine and method error", () => {
	// SPEC §4.20.2 PR4: the header welcome states key off one context map.
	assert.deepEqual(
		uxContextValues({ engineMissing: false, setupNeeded: true }),
		{
			"codictator.engineMissing": false,
			"codictator.methodError": false,
			"codictator.setupNeeded": true,
		},
	);
	assert.deepEqual(
		uxContextValues({
			engineMissing: true,
			methodError: "CDX-E002",
			setupNeeded: false,
		}),
		{
			"codictator.engineMissing": true,
			"codictator.methodError": true,
			"codictator.methodErrorCode": "CDX-E002",
			"codictator.setupNeeded": false,
		},
	);
});

test("[§4.20.2] notifyOnBlock defaults on and the timeline page size defaults to 100", () => {
	// SPEC §4.20.2 PR4: settings `codictator.notifyOnBlock` and
	// `codictator.timeline.pageSize` with safe defaults and clamps.
	assert.equal(
		notifyOnBlockOf(() => undefined),
		true,
	);
	assert.equal(
		notifyOnBlockOf(() => false),
		false,
	);
	assert.equal(
		timelinePageSizeOf(() => undefined),
		100,
	);
	assert.equal(
		timelinePageSizeOf(() => 50),
		50,
	);
	assert.equal(
		timelinePageSizeOf(() => 0),
		1,
	);
	assert.equal(
		timelinePageSizeOf(() => 99999),
		500,
	);
});

test("[§4.20.2] package declares the PR4 commands, header states, refresh button and settings", () => {
	// SPEC §4.20.2 PR4: the contributes rows the header, title and settings
	// surfaces read — commands, per-state welcomes, the refresh button and
	// the two settings.
	const raw = readFileSync(
		new URL("../../package.json", import.meta.url),
		"utf8",
	);
	const manifest = JSON.parse(raw) as {
		contributes?: {
			commands?: Array<{ command?: string }>;
			configuration?: {
				properties?: Record<string, { default?: unknown }>;
			};
			menus?: { "view/title"?: Array<{ command?: string; when?: string }> };
			viewsWelcome?: Array<{ contents?: string; when?: string }>;
		};
	};
	const contributes = manifest.contributes ?? {};
	const commands = (contributes.commands ?? []).map((entry) => entry.command);
	for (const command of [
		"codictator.restartEngine",
		"codictator.showLog",
		"codictator.refresh",
	]) {
		assert.ok(commands.includes(command), `declares ${command}`);
	}
	const welcomes = contributes.viewsWelcome ?? [];
	assert.ok(
		welcomes.some((entry) =>
			(entry.when ?? "").includes("codictator.engineMissing"),
		),
		"declares the engine-missing welcome",
	);
	assert.ok(
		welcomes.some((entry) =>
			(entry.when ?? "").includes("codictator.methodError"),
		),
		"declares the method-error welcome",
	);
	const titleButtons = contributes.menus?.["view/title"] ?? [];
	assert.ok(
		titleButtons.some(
			(entry) =>
				entry.command === "codictator.refresh" &&
				(entry.when ?? "").includes("codictator-"),
		),
		"declares the view-title refresh button",
	);
	const properties = contributes.configuration?.properties ?? {};
	assert.equal(properties["codictator.notifyOnBlock"]?.default, true);
	assert.equal(properties["codictator.timeline.pageSize"]?.default, 100);
});
