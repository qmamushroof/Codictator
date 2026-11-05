// SPEC §4.20.3: palette commands and the human-only terminal seam. Palette
// entries map one-to-one to CLI commands via the engine `run` method
// (§7.15); a human-only answer (CDX-E107) opens an integrated terminal
// pre-filled with the exact command, so the UI is never a bypass (PRD §12
// #22). The setup command behind the "No packs configured" item lives here
// too: human-only, so it pre-fills the versioned setup command and runs
// nothing.
import {
	type EngineRequest,
	engineRequestFor,
	stringFieldOf,
} from "./engine-client.ts";
import type { ExtensionApi } from "./host-adapter.ts";

// SPEC §4.20.3: palette command ids map one-to-one to CLI commands; each
// entry runs its argv through the engine `run` method (§7.15). Keys stay
// sorted so registration order is deterministic without a sort call.
const paletteCommandArgv: Readonly<Record<string, ReadonlyArray<string>>> = {
	"codictator.explain": ["explain"],
	"codictator.regen": ["regen"],
	"codictator.remediateNext": ["remediate", "next"],
	"codictator.status": ["status"],
	"codictator.taskShow": ["task", "show"],
	"codictator.verify": ["verify"],
	"codictator.waive": ["waive"],
};

// SPEC §4.20.3: palette commands map one-to-one to CLI commands; each entry
// runs its argv through the engine `run` method via a real handler.
export function registerPaletteCommands(api: ExtensionApi): void {
	for (const [commandId, argv] of Object.entries(paletteCommandArgv)) {
		api.registerCommand(commandId, () =>
			runPaletteCommand(api, commandId, argv),
		);
	}
}

// SPEC §4.20.2 EC-10: the setup command behind the "No packs configured"
// item and the setup notification. Human-only, so it opens an integrated
// terminal pre-filled with the versioned setup command and runs nothing.
export function runSetupCommand(api: ExtensionApi): string {
	const commandLine = `npx codictator@${api.extensionVersion()} setup`;
	const terminal = api.createTerminal("Codictator Setup");
	terminal.sendText(commandLine, false);
	terminal.show();
	return commandLine;
}

// SPEC §4.19.2: human-only roots refuse agent execution with CDX-E107.
function isHumanOnlyArgv(argv: ReadonlyArray<string>): boolean {
	const [head, sub] = argv;
	return (
		head === "waive" ||
		head === "init" ||
		head === "setup" ||
		head === "uninstall" ||
		(head === "task" && sub === "ack") ||
		(head === "pack" && sub === "accept") ||
		(head === "baseline" && sub === "capture")
	);
}

// SPEC §4.20.3: the CDX-E107 answer opens an integrated terminal pre-filled
// with the exact command; the human runs it, so the UI is never a bypass.
// Fire-and-forget like the setup welcome: pre-fill with execute:false.
export function openPrefilledTerminal(
	api: ExtensionApi,
	name: string,
	commandLine: string,
): string {
	const terminal = api.createTerminal(name);
	terminal.sendText(commandLine, false);
	terminal.show();
	return commandLine;
}

// SPEC §4.20.3: a palette command runs its CLI argv through the engine `run`
// method; a human-only answer (CDX-E107) opens a pre-filled terminal.
export function runPaletteCommand(
	api: ExtensionApi,
	_commandId: string,
	argv: ReadonlyArray<string>,
	request?: EngineRequest,
): Promise<string> {
	const commandLine = `codictator ${argv.join(" ")}`;
	if (isHumanOnlyArgv(argv)) {
		return Promise.resolve(
			openPrefilledTerminal(api, "Codictator", commandLine),
		);
	}
	return runThroughEngine(api, argv, commandLine, request);
}

// SPEC §4.20.3: the palette entry forwards its CLI argv to `run` and
// surfaces the CLI result; without an engine it echoes the command line.
async function runThroughEngine(
	api: ExtensionApi,
	argv: ReadonlyArray<string>,
	commandLine: string,
	request?: EngineRequest,
): Promise<string> {
	const folder = api.workspaceFolderPaths()[0];
	if (folder === undefined) {
		return commandLine;
	}
	let answer: unknown;
	try {
		answer = await engineRequestFor(request)(folder, "run", {
			argv: [...argv],
		});
	} catch (cause: unknown) {
		const message = cause instanceof Error ? cause.message : "";
		if (/CDX-E107|human-only/.test(message)) {
			return openPrefilledTerminal(api, "Codictator", commandLine);
		}
		return commandLine;
	}
	const stdout = stringFieldOf(answer, "stdout");
	return stdout === undefined || stdout === "" ? commandLine : stdout;
}
