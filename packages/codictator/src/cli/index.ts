// SPEC §4.19: composition root. Commands, hook entry, server. May import
// everything (§3.3); owns no §7 format.
import type { Result } from "../kernel/index.ts";

export interface CliOptions {
	readonly argv: ReadonlyArray<string>;
	readonly cwd: string;
}

// SPEC §4.19.3: hook runtime entry; an uncaught error becomes a block.
export function runHook(_options: CliOptions): Promise<number> {
	throw new Error("not implemented: SPEC §4.19.3");
}

// SPEC §4.19: command dispatch (init, regen, verify, task, review, ...).
export function runCommand(_options: CliOptions): Promise<Result<number>> {
	throw new Error("not implemented: SPEC §4.19");
}

// SPEC §7.15: stdio server entry for the vscode extension.
export function runServer(_options: CliOptions): Promise<number> {
	throw new Error("not implemented: SPEC §7.15");
}
