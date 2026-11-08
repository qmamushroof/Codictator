// SPEC §4.2.3: the human-only command preamble. Pack accept and the init
// preamble refuse agents and non-TTYs with the same CDX-E107 block; one
// shared site keeps the two callers from duplicating the token run
// (core/duplication). Split from shared.ts by responsibility
// (core/file-size): shared.ts owns ports, errors and usage, the gate
// helper lives here.
import type { Result } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import { checkHuman, commandEnv, fail } from "./shared.ts";

export function refuseNonHuman(
	req: CommandRequest,
): Result<number> | undefined {
	const human = checkHuman(commandEnv(), []);
	if (!human.ok) {
		return fail(
			"CDX-E107",
			human.error.message,
			human.error.remediation,
			req.json,
		);
	}
	return undefined;
}
