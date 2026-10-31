// SPEC §4.18.3 + §4.6.6: the token-saver helper row from live evidence.
// Split from surfaces.ts by responsibility (core/file-size): this module
// owns the token-saver evidence shape, its summary and its helper row;
// surfaces.ts keeps the status/CI/report builders and composes this row.

import type { EventLogLine } from "./index.ts";

// SPEC §4.18.3 + §4.6.6: one helper tool per required role. `present`
// means config.tools declares the role at an exact pin; `detail` names the
// declared binary and pin. The token-saver role is instead satisfied by
// the engine itself: `present` then means live evidence exists and
// `detail` starts with `engine-satisfied`.
export interface HelperStatus {
	readonly role: string;
	readonly present: boolean;
	readonly detail?: string | undefined;
}

// SPEC §4.18.3 + §4.6.6: the live evidence behind the token-saver row.
// The budget band reads `unavailable` while no usage reaches the status
// path (EC-4: never estimated); the injection hash is the content digest
// carried by the last injection event id, with its message byte count;
// the dedupe count is read-dedupe blocks in the event log.
export interface TokenSaverEvidence {
	readonly budget: string;
	readonly injectionHash: string | undefined;
	readonly injectionBytes: number | undefined;
	readonly dedupeBlocked: number;
}

// SPEC §4.18.3: the token-saver evidence from the event log. Read-dedupe
// blocks are verdicts blocked with the core/read-dedupe rule; the last
// injection event carries the hash (its id ends in the content digest)
// and the byte count (its message length, 0 when messageless).
export function summarizeTokenSaverEvidence(
	events: ReadonlyArray<EventLogLine>,
): TokenSaverEvidence {
	let injectionHash: string | undefined;
	let injectionBytes: number | undefined;
	let dedupeBlocked = 0;
	for (const event of events) {
		if (event.kind === "injection") {
			const cut = event.id.lastIndexOf("-");
			injectionHash = cut < 0 ? event.id : event.id.slice(cut + 1);
			injectionBytes =
				event.message === undefined
					? 0
					: new TextEncoder().encode(event.message).length;
		}
		if (
			event.decision === "block" &&
			event.ruleIds.includes("core/read-dedupe")
		) {
			dedupeBlocked += 1;
		}
	}
	return {
		budget: "unavailable",
		injectionHash,
		injectionBytes,
		dedupeBlocked,
	};
}

// SPEC §4.18.3 + §4.6.6: the token-saver helper row from live evidence.
// All-absent evidence is a finding, not a pass: the role reads missing
// with the gap named instead of claiming engine-satisfied.
export function tokenSaverHelper(evidence: TokenSaverEvidence): HelperStatus {
	if (
		evidence.budget === "unavailable" &&
		evidence.injectionHash === undefined &&
		evidence.dedupeBlocked === 0
	) {
		return {
			role: "token-saver",
			present: false,
			detail:
				"no budget band, no scoped injection and no read-dedupe blocks in the event log",
		};
	}
	const injection =
		evidence.injectionHash === undefined ||
		evidence.injectionBytes === undefined
			? "injection none"
			: `injection ${evidence.injectionHash} ${evidence.injectionBytes}B`;
	return {
		role: "token-saver",
		present: true,
		detail: `engine-satisfied (budget ${evidence.budget}, ${injection}, dedupe ${evidence.dedupeBlocked} blocked)`,
	};
}
