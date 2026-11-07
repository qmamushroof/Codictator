// SPEC §4.19: shared command-context resolution. The root-plus-ports
// preamble every read handler repeats lives here, so the duplicated token
// run the core/duplication gate flags stays in one place.
import type { Result } from "../kernel/index.ts";
import {
	type CommandPorts,
	type CommandRequest,
	fail,
	needRoot,
	portsFor,
} from "./shared.ts";

// SPEC §5.6: one helper answers root, live ports and clock time together,
// so the two call sites share the call instead of the token run.
export async function needCommandContext(
	req: CommandRequest,
): Promise<
	{ root: string; ports: CommandPorts; now: string } | Result<number>
> {
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	return { root, ports: ports.value, now: ports.value.clock.now() };
}
