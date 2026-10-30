// SPEC §7.15: stdio log and budget rows. Event tails and steering
// history page the same event log the audit surfaces read; the budget row
// answers per-session bands, or unavailable when no usage applies.
import { currentBand } from "../features/steering/index.ts";
import { readLogEvents } from "./inspect.ts";
import { invalidParamsError } from "./serve-protocol.ts";
import {
	field,
	isRecord,
	type MethodContext,
	type MethodOutcome,
	methodOk,
	resolveRoot,
} from "./serve-shared.ts";

function numberField(params: unknown, name: string): number | undefined {
	if (!isRecord(params)) {
		return undefined;
	}
	const found = field(params, name);
	return typeof found === "number" ? found : undefined;
}

// SPEC §7.15: `events/tail { since?, limit }` pages the event log.
async function eventsTailMethod(
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome> {
	if (params !== undefined && !isRecord(params)) {
		return {
			ok: false,
			error: invalidParamsError(
				"events/tail params must be { since?, limit? }",
			),
		};
	}
	const root = await resolveRoot(ctx.root);
	const log = await readLogEvents(root);
	if (log === undefined) {
		return {
			ok: false,
			error: {
				code: -32000,
				message: "CDX-E903 event log unreadable",
				data: {
					code: "CDX-E903",
					remediation: "Fix permissions on .codictator/state/, then retry.",
				},
			},
		};
	}
	let since: string | undefined;
	let limit = 100;
	if (isRecord(params)) {
		const rawSince = field(params, "since");
		if (rawSince !== undefined && typeof rawSince !== "string") {
			return {
				ok: false,
				error: invalidParamsError(
					"events/tail since must be an event id string",
				),
			};
		}
		since = typeof rawSince === "string" ? rawSince : undefined;
		const rawLimit = numberField(params, "limit");
		if (field(params, "limit") !== undefined) {
			if (
				rawLimit === undefined ||
				!Number.isSafeInteger(rawLimit) ||
				rawLimit <= 0
			) {
				return {
					ok: false,
					error: invalidParamsError(
						"events/tail limit must be a positive integer",
					),
				};
			}
			limit = Math.min(rawLimit, 1000);
		}
	}
	let start = 0;
	if (since !== undefined) {
		const at = log.events.findIndex((event) => event.id === since);
		start = at === -1 ? log.events.length : at + 1;
	}
	return methodOk({
		events: log.events.slice(start, start + limit),
		corrupt: log.corrupt,
	});
}

// SPEC §7.15: `steering/history { sessionId? }` answers injections,
// optionally for one session.
async function steeringHistoryMethod(
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome> {
	if (params !== undefined && !isRecord(params)) {
		return {
			ok: false,
			error: invalidParamsError(
				"steering/history params must be { sessionId? }",
			),
		};
	}
	let sessionId: string | undefined;
	if (isRecord(params)) {
		const raw = field(params, "sessionId");
		if (raw !== undefined && typeof raw !== "string") {
			return {
				ok: false,
				error: invalidParamsError(
					"steering/history sessionId must be a string",
				),
			};
		}
		sessionId = typeof raw === "string" ? raw : undefined;
	}
	const root = await resolveRoot(ctx.root);
	const log = await readLogEvents(root);
	if (log === undefined) {
		return methodOk({ injections: [] });
	}
	return methodOk({
		injections: log.events.filter(
			(event) =>
				event.kind === "injection" &&
				(sessionId === undefined || event.sessionId === sessionId),
		),
	});
}

// SPEC §7.15: `budget/current` answers per-session bands, or unavailable
// when no usage applies (§4.6.7 EC-4).
async function budgetCurrentMethod(params: unknown): Promise<MethodOutcome> {
	if (params !== undefined && !isRecord(params)) {
		return {
			ok: false,
			error: invalidParamsError("budget/current params must be { sessionId? }"),
		};
	}
	let sessionId = "stdio";
	if (isRecord(params)) {
		const raw = field(params, "sessionId");
		if (raw !== undefined && typeof raw !== "string") {
			return {
				ok: false,
				error: invalidParamsError("budget/current sessionId must be a string"),
			};
		}
		if (typeof raw === "string" && raw !== "") {
			sessionId = raw;
		}
	}
	const band = await currentBand(sessionId);
	return methodOk({
		available: band.available,
		status: band.available ? band.band : "unavailable",
		band: band.band,
		contextWindow: band.contextWindow,
		usedTokens: band.usedTokens,
	});
}

// SPEC §7.15 log rows owned here; unknown names return undefined so the
// caller answers method-not-found.
export async function dispatchLogMethod(
	method: string,
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome | undefined> {
	switch (method) {
		case "events/tail": {
			return eventsTailMethod(params, ctx);
		}
		case "steering/history": {
			return steeringHistoryMethod(params, ctx);
		}
		case "budget/current": {
			return budgetCurrentMethod(params);
		}
		default: {
			return undefined;
		}
	}
}
