// SPEC §4.18.3-§4.18.5: replay, status, the CI summary and report.
// Pure builders over caller-supplied inputs: the CLI (composition root)
// reads the event log and config through ports and passes the data in, so
// this module stays kernel-only per SPEC §3.3.

import type { EventLogLine } from "./index.ts";

// SPEC §4.18.3: per-harness layer state for the status screen.
export type HarnessLayerState =
	| "active"
	| "inactive"
	| "unknown"
	| "unverified";

export interface HarnessStatus {
	readonly harness: string;
	readonly state: HarnessLayerState;
	readonly layers: string;
}

// SPEC §4.18.3 + §4.6.6: one helper tool per required role. `present`
// means config.tools declares the role at an exact pin; `detail` names the
// declared binary and pin.
export interface HelperStatus {
	readonly role: string;
	readonly present: boolean;
	readonly detail?: string | undefined;
}

export interface StatusInput {
	readonly engineVersion: string;
	readonly packs: Readonly<Record<string, string>>;
	readonly harnesses: ReadonlyArray<HarnessStatus>;
	readonly helpers?: ReadonlyArray<HelperStatus> | undefined;
	readonly events: number;
	readonly corrupt: number;
	readonly gap: boolean;
	readonly task?: string | undefined;
	readonly waivers?: string | undefined;
	readonly ratchet?: string | undefined;
	readonly deps?: string | undefined;
	readonly integrity?: string | undefined;
	readonly escalations?: string | undefined;
	readonly remediation?: string | undefined;
	readonly now: string;
}

// SPEC §4.6.6: every required role renders present with its binary and
// pin, or missing; no required roles reads "none declared".
function helpersLine(helpers: ReadonlyArray<HelperStatus> | undefined): string {
	if (helpers === undefined || helpers.length === 0) {
		return "helpers: none declared";
	}
	const parts = helpers.map((helper) =>
		helper.present
			? `${helper.role} present${helper.detail === undefined ? "" : ` (${helper.detail})`}`
			: `${helper.role} missing`,
	);
	return `helpers: ${parts.join(", ")}`;
}

// SPEC §4.18.3: one screen with engine, packs, harness states, helper
// tools, task, waivers, ratchet, deps, integrity, escalations and
// remediation progress.
export function buildStatusText(input: StatusInput): string {
	const packs = Object.entries(input.packs)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([name, version]) => `${name}@${version}`);
	const lines = [
		`codictator ${input.engineVersion} status at ${input.now}`,
		`packs: ${packs.length === 0 ? "none configured" : packs.join(", ")}`,
		"harnesses:",
	];
	for (const harness of input.harnesses) {
		lines.push(`- ${harness.harness}: ${harness.state} (${harness.layers})`);
	}
	lines.push(helpersLine(input.helpers));
	lines.push(`task: ${input.task ?? "none active"}`);
	lines.push(`waivers: ${input.waivers ?? "none in force"}`);
	lines.push(`ratchet: ${input.ratchet ?? "no baseline history"}`);
	lines.push(`deps: ${input.deps ?? "freshness unknown"}`);
	lines.push(`integrity: ${input.integrity ?? "unverified"}`);
	lines.push(`escalations: ${input.escalations ?? "none open"}`);
	lines.push(`remediation: ${input.remediation ?? "no plan"}`);
	lines.push(
		`events: ${input.events} observed, ${input.corrupt} corrupt${input.gap ? "; gap in coverage, log was deleted mid-session" : ""}`,
	);
	return lines.join("\n");
}

// SPEC §4.18.3: the same status as data for the extension (--json).
export function buildStatusJson(input: StatusInput): unknown {
	return {
		engineVersion: input.engineVersion,
		packs: { ...input.packs },
		harnesses: input.harnesses.map((harness) => ({ ...harness })),
		helpers:
			input.helpers === undefined
				? null
				: input.helpers.map((helper) => ({ ...helper })),
		events: input.events,
		corrupt: input.corrupt,
		gap: input.gap,
		task: input.task ?? null,
		waivers: input.waivers ?? null,
		ratchet: input.ratchet ?? null,
		deps: input.deps ?? null,
		integrity: input.integrity ?? null,
		escalations: input.escalations ?? null,
		remediation: input.remediation ?? null,
		now: input.now,
	};
}

// SPEC §4.18.2: an event explains as its verdict, its inputs and its replay.
export function replaySummary(event: EventLogLine): string {
	const packs = Object.entries(event.packs)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([name, version]) => `${name}@${version}`)
		.join(", ");
	return [
		`event ${event.id}: ${event.kind}/${event.layer} ${event.decision ?? "observed"}`,
		`inputs: config ${event.configHash}, packs ${packs === "" ? "none" : packs}, now ${event.now}`,
		`rerun: codictator replay ${event.id}`,
	].join("\n");
}

export interface CiSummaryInput {
	readonly integrity: ReadonlyArray<string>;
	readonly blocking: ReadonlyArray<string>;
	readonly exceptions: ReadonlyArray<string>;
	readonly waivers: ReadonlyArray<string>;
	readonly deps: ReadonlyArray<string>;
	readonly remediation: ReadonlyArray<string>;
	readonly unverifiable: ReadonlyArray<string>;
	readonly command: string;
}

const CI_SUMMARY_MAX_BYTES = 60000;

function section(title: string, lines: ReadonlyArray<string>): Array<string> {
	if (lines.length === 0) {
		return [`## ${title}`, "none"];
	}
	return [`## ${title}`, ...lines];
}

// SPEC §4.18.4: Markdown in §4.18.4 order. Past 60 KB the lower-priority
// sections collapse to counts with the command to see all (EC-6).
export function buildCiSummary(input: CiSummaryInput): string {
	const full = [
		"# codictator CI summary",
		...section("integrity then blocking findings", [
			...input.integrity,
			...input.blocking,
		]),
		...section("exceptions and review identity", input.exceptions),
		...section("waivers and ratchet movement", input.waivers),
		...section("dependencies", input.deps),
		...section("remediation progress", input.remediation),
		...section("unverifiable items", input.unverifiable),
	].join("\n");
	const bytes = new TextEncoder().encode(full).length;
	if (bytes <= CI_SUMMARY_MAX_BYTES) {
		return full;
	}
	const kept = [
		"# codictator CI summary (truncated with counts)",
		...section("integrity then blocking findings", [
			...input.integrity,
			...input.blocking,
		]),
		`exceptions: ${input.exceptions.length}, waivers: ${input.waivers.length}, deps: ${input.deps.length}, remediation: ${input.remediation.length}, unverifiable: ${input.unverifiable.length}`,
		`run \`${input.command}\` for the full list`,
	].join("\n");
	return kept;
}

export interface ReportInput {
	readonly events: ReadonlyArray<EventLogLine>;
	readonly corrupt: number;
	readonly now: string;
}

function rateText(matched: number, total: number): string {
	if (total === 0) {
		return "no blocks observed";
	}
	return `${matched}/${total}`;
}

// SPEC §4.18.5: PRD §10 metrics from local sources only. Token metrics read
// "unavailable" where no harness reports usageData (EC-7), never zero.
export function buildReportText(input: ReportInput): string {
	let blocks = 0;
	let corrections = 0;
	let escalations = 0;
	const latencies: Array<number> = [];
	for (const event of input.events) {
		if (event.decision === "block") {
			blocks += 1;
		}
		if (event.kind === "escalation") {
			escalations += 1;
		}
		if (event.decision === "block" || event.decision === "allow") {
			corrections += event.decision === "allow" ? 1 : 0;
		}
		latencies.push(event.durationMs);
	}
	latencies.sort((left, right) => left - right);
	const p95 =
		latencies.length === 0
			? "no events observed"
			: `${latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0}ms`;
	return [
		`codictator report at ${input.now}`,
		`self-correction rate: ${rateText(corrections, blocks)} (allow after block, same rule and task)`,
		`loop-breaker escalations: ${escalations}`,
		"tokens per task, band breaches: unavailable (no harness usage data)",
		`p95 event latency: ${p95}; install-to-green: unavailable (needs baseline history)`,
		"ratchet totals: unavailable (needs git log of baseline.json)",
		`corrupt lines skipped: ${input.corrupt}`,
	].join("\n");
}
