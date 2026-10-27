// SPEC §4.18.1: line-delimited event log reads for explain, status and
// summaries. Corrupt lines are counted and skipped so one bad line never
// hides the rest of the log.

import type { Ports } from "../../kernel/index.ts";
import { err, ok, parseJson, type Result } from "../../kernel/index.ts";
import { LOG_REL } from "./append.ts";
import type { EventLogLine } from "./index.ts";

export interface ReadEvents {
	readonly events: ReadonlyArray<EventLogLine>;
	readonly corrupt: number;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (kernel schema.ts pattern).
function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function isEventLine(value: unknown): value is EventLogLine {
	if (!isStringRecord(value)) {
		return false;
	}
	return (
		field(value, "v") === 1 &&
		typeof field(value, "id") === "string" &&
		typeof field(value, "kind") === "string" &&
		typeof field(value, "layer") === "string" &&
		typeof field(value, "trigger") === "string" &&
		Array.isArray(field(value, "ruleIds")) &&
		typeof field(value, "durationMs") === "number" &&
		typeof field(value, "configHash") === "string" &&
		isStringRecord(field(value, "packs"))
	);
}

function parseLines(text: string): ReadEvents {
	const events: Array<EventLogLine> = [];
	let corrupt = 0;
	for (const line of text.split("\n")) {
		if (line === "") {
			continue;
		}
		const parsed = parseJson(line);
		if (!parsed.ok || !isEventLine(parsed.value)) {
			corrupt += 1;
			continue;
		}
		events.push(parsed.value);
	}
	return { events, corrupt };
}

// A missing log is an empty log (SPEC §4.18.6 EC-3 recreates it on the next
// append); only real I/O failures are errors.
export async function readEvents(
	ports: Ports,
	repoRoot: string,
): Promise<Result<ReadEvents>> {
	const stripped = repoRoot.replace(/\/+$/, "");
	const root = stripped === "" ? "." : stripped;
	const logRel = `${root}/${LOG_REL}`;
	const seen = await ports.fs.exists(logRel);
	if (!seen.ok) {
		return err(seen.error);
	}
	if (!seen.value) {
		return ok({ events: [], corrupt: 0 });
	}
	const text = await ports.fs.readText(logRel);
	if (!text.ok) {
		return err(text.error);
	}
	return ok(parseLines(text.value));
}
