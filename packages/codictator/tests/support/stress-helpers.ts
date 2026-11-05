// SPEC §10.5: shared stress-row helpers. findingIds and findingEntries
// read rule ids out of a verify envelope (never file contents or secret
// values); recordTiming appends per-leg budget evidence best-effort, so a
// red leg still leaves its numbers without ever failing the test.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function findingIds(envelope: unknown): Array<string> {
	if (typeof envelope !== "object" || envelope === null) {
		return [];
	}
	const findings: unknown = (envelope as { findings?: unknown }).findings;
	if (!Array.isArray(findings)) {
		return [];
	}
	const ids: Array<string> = [];
	for (const finding of findings) {
		if (typeof finding === "object" && finding !== null) {
			const ruleId: unknown = (finding as { ruleId?: unknown }).ruleId;
			if (typeof ruleId === "string") {
				ids.push(ruleId);
			}
		}
	}
	return ids;
}

export function findingEntries(
	envelope: unknown,
): Array<{ readonly ruleId: string; readonly code: string | undefined }> {
	if (typeof envelope !== "object" || envelope === null) {
		return [];
	}
	const findings: unknown = (envelope as { findings?: unknown }).findings;
	if (!Array.isArray(findings)) {
		return [];
	}
	const entries: Array<{
		readonly ruleId: string;
		readonly code: string | undefined;
	}> = [];
	for (const finding of findings) {
		if (typeof finding === "object" && finding !== null) {
			const ruleId: unknown = (finding as { ruleId?: unknown }).ruleId;
			if (typeof ruleId === "string") {
				const code: unknown = (finding as { code?: unknown }).code;
				entries.push({
					ruleId,
					code: typeof code === "string" ? code : undefined,
				});
			}
		}
	}
	return entries;
}

// Row-3 per-leg timings for CI evidence (PR #67 HOLD): appended
// best-effort after each leg's measurement, before the budget assert,
// so a red leg still leaves its numbers. Records findingIds(envelope)
// (rule IDs only, never file contents or secret values) plus the leg's
// exit code, so the artifact pins the full honest-scale contract
// (budget, exit, evidence) per leg. Never throws.
export function recordTiming(entry: {
	readonly test?: string;
	readonly leg: string;
	readonly ms?: number;
	readonly budgetMs?: number;
	readonly pass?: boolean;
	readonly findings?: ReadonlyArray<string>;
	readonly code?: number;
	readonly message?: string;
}): void {
	try {
		const dir = path.join(process.cwd(), "test-results");
		const file = path.join(dir, "stress-timings.json");
		mkdirSync(dir, { recursive: true });
		let rows: Array<unknown> = [];
		try {
			if (existsSync(file)) {
				const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
				if (Array.isArray(parsed)) {
					rows = parsed;
				}
			}
		} catch {
			rows = [];
		}
		rows.push(entry);
		writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
	} catch {
		// Best-effort only: timing evidence must never fail the test.
	}
}
