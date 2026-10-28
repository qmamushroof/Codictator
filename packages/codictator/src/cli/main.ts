// SPEC §4.19: the built engine entry (dist/cli/main.js) the launcher
// resolves (§4.19.3). Hook words go to the hook runtime; every other word
// goes through the command table, whose printed output is already emitted
// and whose Result maps to the §8.2 exit.
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
