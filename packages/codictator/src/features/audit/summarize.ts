// SPEC §4.18.6 EC-3: minimal Phase-4 status summary over the requested
// window. The log read (readEvents) and truncation with counts (EC-6) land
// with the Phase 9 audit surfaces, so every requested slot is unobserved
// and reported as a gap entry; usage rollups (EC-7) stay out until then.
import { redactSecrets } from "../../kernel/index.ts";

// SPEC §4.18.3: status summary over recent events. Pure and deterministic:
// one entry per requested slot, gap entries where no event is observed.
export function summarize(since: string, limit: number): Promise<string> {
	const lines = [
		`status since ${since}: gap in event coverage, no events observed`,
	];
	for (let slot = 1; slot <= limit; slot += 1) {
		lines.push(`gap: event ${slot} of the last ${limit} not observed`);
	}
	return Promise.resolve(redactSecrets(lines.join("\n")));
}
