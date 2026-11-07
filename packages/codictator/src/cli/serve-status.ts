// SPEC §7.15 + §4.18.3: the stdio `status` row. Answers the §4.18.3 JSON
// over the same inputs the `status` command renders: engine, packs,
// harness states, helper tools, event counts and the pending sections.

import { buildStatusJson } from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { readLogEvents } from "./inspect.ts";
import {
	type MethodContext,
	type MethodOutcome,
	methodOk,
	resolveRoot,
} from "./serve-shared.ts";
import { portsFor } from "./shared.ts";
import { collectStatusFrame, statusInput } from "./status-rows.ts";

export async function statusMethod(ctx: MethodContext): Promise<MethodOutcome> {
	const root = await resolveRoot(ctx.root);
	const ports = await portsFor(root);
	if (!ports.ok) {
		return {
			ok: false,
			error: {
				code: -32000,
				message: `${ports.error.code} ${ports.error.message}`,
				data: {
					code: ports.error.code,
					remediation: ports.error.remediation,
				},
			},
		};
	}
	const log = await readLogEvents(root);
	const events = log?.events ?? [];
	const engineVersion = ctx.engineVersion ?? ENGINE_VERSION;
	const now = ports.value.clock.now();
	const frame = await collectStatusFrame(
		root,
		engineVersion,
		events,
		log?.corrupt ?? 0,
		now,
	);
	return methodOk(buildStatusJson(statusInput(frame, engineVersion, now)));
}
