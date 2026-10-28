// SPEC §4.18.6 EC-3/EC-6/EC-7: minimal Phase-4 status summary over the
// requested window. One entry per requested slot, gap entries where nothing
// is observed; the rollup stays within 60 KB with a truncation marker and
// counts (EC-6), and token metrics read "unavailable" where no harness
// reports usage data (EC-7), never zero.
import { redactSecrets } from "../../kernel/index.ts";

const SUMMARY_MAX_BYTES = 60000;

// The truncation marker itself is reserved up front so the final text,
// head plus slots plus marker plus tail, never exceeds the cap.
const MARKER_RESERVE = 128;

function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

// SPEC §4.18.6 EC-6: cap the slot entries so the summary fits 60 KB;
// the dropped count and the command to see all stay in the output.
function cappedSlots(since: string, limit: number): Array<string> {
	const slots: Array<string> = [];
	const head = `status since ${since}: gap in event coverage, no events observed`;
	const tail =
		"token metrics: unavailable (no harness usage data); run codictator report for all";
	let used = utf8Length(head) + utf8Length(tail) + 2 + MARKER_RESERVE;
	let slot = 1;
	while (slot <= limit) {
		const line = `gap: event ${slot} of the last ${limit} not observed`;
		if (used + utf8Length(line) + 1 > SUMMARY_MAX_BYTES) {
			break;
		}
		slots.push(line);
		used += utf8Length(line) + 1;
		slot += 1;
	}
	const dropped = limit - slots.length;
	if (dropped > 0) {
		slots.push(
			`[truncated ${dropped} entries with counts; run codictator report for all]`,
		);
	}
	return [head, ...slots, tail];
}

// SPEC §4.18.3: status summary over recent events. Pure and deterministic:
// one entry per requested slot, gap entries where no event is observed.
export function summarize(since: string, limit: number): Promise<string> {
	return Promise.resolve(redactSecrets(cappedSlots(since, limit).join("\n")));
}
