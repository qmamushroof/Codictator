// SPEC §10.2: a fixed Clock for deterministic tests. Unit tests never read
// the wall clock (SPEC §10.3); they inject this fake through the Clock port
// (SPEC §4.1.1) so repeated runs observe the same instant.
import type { Clock, Instant } from "../../src/kernel/index.ts";

export const FIXED_INSTANT: Instant = "2026-01-01T00:00:00.000Z";

export class FakeClock implements Clock {
	private current: Instant;

	constructor(initial: Instant = FIXED_INSTANT) {
		this.current = initial;
	}

	now(): Instant {
		return this.current;
	}

	set(instant: Instant): void {
		this.current = instant;
	}

	advanceMs(ms: number): void {
		this.current = new Date(Date.parse(this.current) + ms).toISOString();
	}
}
