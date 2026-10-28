// SPEC §4.19: the built engine entry (dist/cli/main.js) the launcher
// resolves (§4.19.3). Only hook dispatch lives here until phase 9 builds
// the full command surface; every other command answers the usage error.
import { runHook } from "./index.ts";

function usageError(): number {
	process.stderr.write("usage: codictator hook <harness> <event>\n");
	return 2;
}

export async function main(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<number> {
	if (argv[0] !== "hook") {
		return usageError();
	}
	return runHook({ argv, cwd });
}
