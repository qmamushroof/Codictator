// SPEC §4.3.4 + §11 S11: waiver date and renewal-chain math, split from
// waivers.ts by responsibility (CONVENTIONS size). Time comes from the
// Clock port and engine code never touches Date (SPEC §10.3 item 3).
import type { Instant } from "../../kernel/index.ts";
import type { Waiver, WaiverStore } from "./waivers.ts";

export function todayOf(now: Instant): string {
	return now.slice(0, 10);
}

export function activeOn(waiver: Waiver, today: string): boolean {
	return waiver.created <= today && today <= waiver.expires;
}

function chainHops(store: WaiverStore, waiver: Waiver): number {
	let hops = 0;
	let current: Waiver | undefined = waiver;
	const seen = new Set<string>();
	while (current?.renews !== undefined) {
		if (seen.has(current.id)) {
			return Number.MAX_SAFE_INTEGER;
		}
		seen.add(current.id);
		const previous = store.waivers.find(
			(entry) => entry.id === current?.renews,
		);
		if (previous === undefined) {
			return Number.MAX_SAFE_INTEGER;
		}
		hops += 1;
		current = previous;
	}
	return hops;
}

// Days from the civil date, Howard Hinnant's algorithm, so waiver spans
// need no clock: time comes from the Clock port and engine code never
// touches Date (SPEC §10.3 item 3).
function daysFromCivil(date: string): number | undefined {
	const parts = date.split("-");
	if (parts.length !== 3) {
		return undefined;
	}
	const year = Number.parseInt(parts[0] ?? "", 10);
	const month = Number.parseInt(parts[1] ?? "", 10);
	const day = Number.parseInt(parts[2] ?? "", 10);
	if (
		!Number.isSafeInteger(year) ||
		!Number.isSafeInteger(month) ||
		!Number.isSafeInteger(day)
	) {
		return undefined;
	}
	const shiftedMonth = month <= 2 ? month + 9 : month - 3;
	const shiftedYear = month <= 2 ? year - 1 : year;
	const era = Math.floor(shiftedYear / 400);
	const yearOfEra = shiftedYear - era * 400;
	const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
	const dayOfEra =
		yearOfEra * 365 +
		Math.floor(yearOfEra / 4) -
		Math.floor(yearOfEra / 100) +
		dayOfYear;
	return era * 146097 + dayOfEra - 719468;
}

function chainStart(store: WaiverStore, waiver: Waiver): Waiver {
	let current = waiver;
	while (current.renews !== undefined) {
		const previous = store.waivers.find((entry) => entry.id === current.renews);
		if (previous === undefined) {
			return current;
		}
		current = previous;
	}
	return current;
}

// SPEC §4.3.4 with §11 S11: one renewal, and the chain may not exceed
// 2 × maxWaiverDays from the first created date; a single waiver may not
// exceed maxWaiverDays (the evaluation-side mirror of the CDX-E110 load
// error). A waiver outside these bounds is inert at evaluation; it never
// suppresses (fail closed, PRD §12 #12).
export function chainValid(store: WaiverStore, waiver: Waiver): boolean {
	const hops = chainHops(store, waiver);
	if (hops > 1) {
		return false;
	}
	const start = chainStart(store, waiver).created;
	const startDays = daysFromCivil(start);
	const endDays = daysFromCivil(waiver.expires);
	if (startDays === undefined || endDays === undefined) {
		return false;
	}
	const spanDays = endDays - startDays;
	if (spanDays < 0) {
		return false;
	}
	const limit = hops === 0 ? store.maxWaiverDays : 2 * store.maxWaiverDays;
	return spanDays <= limit;
}
