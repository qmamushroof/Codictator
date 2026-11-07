// SPEC §4.20.2 PR4: the status bar item. States: shield with rule and
// block counts while connected, a spinner while connecting, the engine
// error code on failure. A known budget band tints the item; clicking
// focuses the Codictator view.
export type StatusBarConnection =
	| "connected"
	| "connecting"
	| "engine-error"
	| "engine-missing";

export interface StatusBarInput {
	readonly connection: StatusBarConnection;
	readonly ruleCount: number;
	readonly blockCount: number;
	readonly unseenBlocks?: number;
	readonly band?: string;
	readonly errorCode?: string;
}

export interface StatusBarContent {
	readonly text: string;
	readonly tooltip: string;
	readonly color?: string;
	readonly command: string;
}

// SPEC §4.20.2 PR4: the budget band colour. Plain CSS strings, so no API
// newer than 1.105 is needed (EC-6); unknown bands stay uncoloured.
export function bandColorFor(band?: string): string | undefined {
	switch (band) {
		case "amber":
		case "yellow": {
			return "#e5a50a";
		}
		case "red": {
			return "#f14c4c";
		}
		default: {
			return undefined;
		}
	}
}

// SPEC §4.20.2 PR4: the item content per connection state. One helper per
// state keeps the switch flat.
function connectingContent(focus: string): StatusBarContent {
	return {
		command: focus,
		text: "$(sync~spin) Codictator: connecting",
		tooltip: "Codictator engine is starting…",
	};
}

function engineErrorContent(
	focus: string,
	errorCode?: string,
): StatusBarContent {
	const code = errorCode === undefined ? "" : ` ${errorCode}`;
	return {
		command: focus,
		text: `$(error) Codictator: engine error${code}`,
		tooltip: `Codictator engine failed${code}. Open the log for detail.`,
	};
}

function engineMissingContent(focus: string): StatusBarContent {
	return {
		command: focus,
		text: "$(warning) Codictator: engine missing",
		tooltip: "Codictator engine is not installed. Install it to connect.",
	};
}

function connectedContent(
	focus: string,
	input: StatusBarInput,
): StatusBarContent {
	const unseen =
		input.unseenBlocks === undefined || input.unseenBlocks === 0
			? ""
			: ` · ${input.unseenBlocks} new`;
	const text = `$(shield) Codictator: ${input.ruleCount} rules · ${input.blockCount} blocks${unseen}`;
	const color = bandColorFor(input.band);
	const tooltip =
		input.band === undefined
			? `Codictator: ${input.ruleCount} rules, ${input.blockCount} blocks`
			: `Codictator: ${input.ruleCount} rules, ${input.blockCount} blocks, budget ${input.band}`;
	if (color === undefined) {
		return { command: focus, text, tooltip };
	}
	return { color, command: focus, text, tooltip };
}

export function statusBarContent(input: StatusBarInput): StatusBarContent {
	const focus = "codictator.focusViews";
	switch (input.connection) {
		case "connecting": {
			return connectingContent(focus);
		}
		case "engine-error": {
			return engineErrorContent(focus, input.errorCode);
		}
		case "engine-missing": {
			return engineMissingContent(focus);
		}
		case "connected": {
			return connectedContent(focus, input);
		}
	}
}

// The narrow ports the status bar needs from the host: one item plus the
// focus-command seam. The item shape mirrors vscode's StatusBarItem with
// plain strings only, so the source stays erasable-syntax (SPEC §4.20.1).
export interface StatusBarItemHandle {
	text: string;
	tooltip: string;
	color?: string;
	command?: string;
	show(): void;
	dispose(): void;
}

export interface StatusBarPorts {
	createItem(): StatusBarItemHandle;
}

// SPEC §4.20.2 PR4: register the item; each update re-renders the content
// once. The focus command behind the click (`codictator.focusViews`) is
// registered with the other UX commands, so the item only names it.
export function registerStatusBar(ports: StatusBarPorts): {
	dispose(): void;
	update(input: StatusBarInput): void;
} {
	const item = ports.createItem();
	return {
		dispose: (): void => {
			item.dispose();
		},
		update: (input: StatusBarInput): void => {
			const content = statusBarContent(input);
			item.text = content.text;
			item.tooltip = content.tooltip;
			item.command = content.command;
			if (content.color === undefined) {
				delete item.color;
			} else {
				item.color = content.color;
			}
			item.show();
		},
	};
}
