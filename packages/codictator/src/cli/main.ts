// SPEC §4.19: the built engine entry (dist/cli/main.js) the launcher
// resolves (§4.19.3). Hook words go to the hook runtime; every other word
// goes through the command table, whose printed output is already emitted
// and whose Result maps to the §8.2 exit.
import { isEntryModule } from "../kernel/index.ts";
import { runCommand, runHook } from "./index.ts";
import { exitFor } from "./shared.ts";

function usageError(): number {
	process.stderr.write("usage: codictator <command> [flags]\n");
	return 2;
}

export async function main(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<number> {
	if (argv[0] === "hook") {
		return runHook({ argv, cwd });
	}
	if (argv[0] === undefined) {
		return usageError();
	}
	const result = await runCommand({ argv, cwd });
	if (result.ok) {
		return result.value;
	}
	return exitFor(result.error.code);
}

// The bin entry point: executing this file runs the CLI over the process
// argv, so the built dist/cli/main.js answers the launcher and --help
// alike. Importing this module (tests, the hook-path engine shim) never
// runs it: only the executed entry path resolves to this file. The compare
// is realpath-aware, so workspace and npm-link installs whose argv keeps
// the symlink spelling still run instead of exiting silently.
const invokedAsScript = isEntryModule(process.argv[1], import.meta.url);

if (invokedAsScript) {
	process.exitCode = await main(process.argv.slice(2), process.cwd());
}
