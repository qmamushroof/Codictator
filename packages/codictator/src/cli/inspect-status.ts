// SPEC §4.18.3: the status screen. Split from the verify command
// (inspect.ts) by responsibility: read-only screen here, trigger evaluation
// there. The event log, config and ports stay caller-owned.
import { parseArgs } from "node:util";
import type { EventLogLine } from "../features/audit/index.ts";
import {
	buildStatusJson,
	buildStatusText,
	readEvents,
} from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { ok, type Result } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";
import { collectStatusFrame, statusInput } from "./status-rows.ts";

// SPEC §4.18.1: the repo's event lines through caller-owned ports against
// the logical root "." (the Fs port takes repo-relative paths only).
export async function readLogEvents(
	root: string,
): Promise<
	{ events: ReadonlyArray<EventLogLine>; corrupt: number } | undefined
> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return undefined;
	}
	const read = await readEvents(ports.value, ".");
	return read.ok ? read.value : undefined;
}

function terseArgs(args: ReadonlyArray<string>, count: number): boolean {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {},
			allowPositionals: true,
		});
		return parsed.positionals.length === count;
	} catch {
		return false;
	}
}

// SPEC §4.18.3: one screen with engine, packs, harness states, task, waivers,
// ratchet, deps, integrity, escalations and remediation progress.
export async function handleStatus(
	req: CommandRequest,
): Promise<Result<number>> {
	if (!terseArgs(req.args, 0)) {
		return usageError("usage: codictator status");
	}
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
	const now = ports.value.clock.now();
	const log = await readLogEvents(root);
	const events = log?.events ?? [];
	const frame = await collectStatusFrame(
		root,
		req.engineVersion ?? ENGINE_VERSION,
		events,
		log?.corrupt ?? 0,
		now,
	);
	const input = statusInput(frame, req.engineVersion ?? ENGINE_VERSION, now);
	if (req.json) {
		printJson(buildStatusJson(input));
	} else {
		printHuman(buildStatusText(input), req.quiet);
	}
	return ok(0);
}
