// SPEC §4.1.1: the real Clock port. Time comes from here and nowhere else,
// so tests and replay inject a fixed instant through the port instead
// (CONVENTIONS, SPEC §10.3).
import type { Clock, Instant } from "./index.ts";

export class SystemClock implements Clock {
	now(): Instant {
		return new Date().toISOString();
	}
}
