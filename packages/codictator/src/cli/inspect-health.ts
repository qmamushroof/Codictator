// Split from inspect-status.ts by responsibility (core/file-size):
// the shared health builder lives here so the status screen and
// the stdio row render the same live state.
import type { EventLogLine } from "../features/audit/index.ts";
import type { RemediationPlan } from "../features/remediation/index.ts";
import type { TaskRecord } from "../features/workflow/index.ts";
import { resolveActiveTask } from "../features/workflow/index.ts";
import { parseJson } from "../kernel/index.ts";
import { readRemediationPlan } from "./remediation.ts";
import { readStateText } from "./shared.ts";
import { branchOf, listTaskIds, readTask, taskLine } from "./tasks.ts";

// SPEC §4.18.3 D9: one health builder feeds the status screen and the
// stdio row. Every field renders from live state; a missing source
// stays undefined so the screen fallback names the gap.
export interface HealthFields {
	readonly task?: string | undefined;
	readonly waivers?: string | undefined;
	readonly ratchet?: string | undefined;
	readonly deps?: string | undefined;
	readonly integrity?: string | undefined;
	readonly escalations?: string | undefined;
	readonly remediation?: string | undefined;
}

async function activeTask(root: string): Promise<TaskRecord | undefined> {
	const records: Array<TaskRecord> = [];
	for (const id of await listTaskIds(root)) {
		const record = await readTask(root, id);
		if (record !== undefined) {
			records.push(record);
		}
	}
	const branch = await branchOf(root);
	if (branch === undefined) {
		return undefined;
	}
	return resolveActiveTask(records, branch);
}

function integrityField(task: TaskRecord | undefined): string | undefined {
	if (task === undefined) {
		return undefined;
	}
	const rounds = task.reviews ?? [];
	const last = rounds[rounds.length - 1];
	const acknowledged = last === undefined ? [] : last.acknowledgedExceptions;
	const pending = (task.integrityExceptions ?? []).filter(
		(id) => !acknowledged.includes(id),
	);
	if (pending.length === 0) {
		return "clear";
	}
	return `${pending.length} pending (${[...pending].sort().join(", ")})`;
}

interface WaiverRow {
	readonly rule: string;
	readonly expires: string;
}

function waiverRowOf(entry: unknown): WaiverRow | undefined {
	if (typeof entry !== "object" || entry === null) {
		return undefined;
	}
	const record = entry as { rule?: unknown; expires?: unknown };
	if (typeof record.rule !== "string" || typeof record.expires !== "string") {
		return undefined;
	}
	if (record.rule === "" || record.expires === "") {
		return undefined;
	}
	return { rule: record.rule, expires: record.expires };
}

function waiverRowsOf(text: string): Array<WaiverRow> {
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return [];
	}
	const listed = (parsed.value as { waivers?: unknown }).waivers;
	if (!Array.isArray(listed)) {
		return [];
	}
	const rows: Array<WaiverRow> = [];
	for (const entry of listed) {
		const row = waiverRowOf(entry);
		if (row !== undefined) {
			rows.push(row);
		}
	}
	return rows;
}

function waiversField(rows: Array<WaiverRow>): string {
	if (rows.length === 0) {
		return "none in force";
	}
	const sorted = [...rows].sort(compareWaiverExpiry);
	const soonest = sorted[0];
	return `${rows.length} in force, soonest expires ${soonest?.expires} (${soonest?.rule})`;
}

// SPEC §4.18.3: the soonest expiry sorts first, so the screen names the
// nearest renewal. Equal expiries keep their listed order.
function compareWaiverExpiry(left: WaiverRow, right: WaiverRow): number {
	if (left.expires === right.expires) {
		return 0;
	}
	return left.expires < right.expires ? -1 : 1;
}

// SPEC §4.18.3: the ratchet baseline against the measures trend over the
// last N L5 verdicts. Halves compare block counts, so a quieter recent
// half reads improving and a louder one regressing.
function ratchetField(
	baselineText: string | undefined,
	events: ReadonlyArray<EventLogLine>,
): string | undefined {
	if (baselineText === undefined) {
		return undefined;
	}
	const parsed = parseJson(baselineText);
	const entries =
		parsed.ok && typeof parsed.value === "object" && parsed.value !== null
			? (parsed.value as { entries?: unknown }).entries
			: undefined;
	const baselined =
		typeof entries === "object" && entries !== null
			? Object.keys(entries).length
			: 0;
	const recent = events.filter((event) => event.layer === "L5").slice(-20);
	if (recent.length === 0) {
		return `${baselined} baselined, no L5 events yet`;
	}
	const blocks = recent.filter((event) => event.decision === "block").length;
	const allows = recent.filter((event) => event.decision === "allow").length;
	const half = Math.floor(recent.length / 2);
	const older = recent
		.slice(0, half)
		.filter((event) => event.decision === "block").length;
	const newer = recent
		.slice(half)
		.filter((event) => event.decision === "block").length;
	const trend =
		newer < older ? "improving" : newer > older ? "regressing" : "flat";
	return `${baselined} baselined, last ${recent.length} L5: ${blocks} block / ${allows} allow (trend ${trend})`;
}

function snapshotStamp(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	for (const key of ["fetchedAt", "recordedAt", "capturedAt"]) {
		const seen = (value as Record<string, unknown>)[key];
		if (typeof seen === "string" && seen !== "") {
			return seen;
		}
	}
	return undefined;
}

// SPEC §4.8.4: snapshots younger than 24 h read fresh; older ones read
// stale; a missing snapshot leaves the freshness-unknown fallback.
function depsField(
	snapshotText: string | undefined,
	now: string,
): string | undefined {
	if (snapshotText === undefined) {
		return undefined;
	}
	const parsed = parseJson(snapshotText);
	if (!parsed.ok) {
		return "present, age unknown";
	}
	const stamp = snapshotStamp(parsed.value);
	if (stamp === undefined) {
		return "present, age unknown";
	}
	const ageMs = Date.parse(now) - Date.parse(stamp);
	if (!Number.isFinite(ageMs) || ageMs < 0) {
		return "present, age unknown";
	}
	const hours = Math.floor(ageMs / 3600000);
	if (ageMs <= 24 * 3600000) {
		return "fresh";
	}
	return `stale (older than 24h, ${hours}h old)`;
}

function remediationField(
	plan: RemediationPlan | null | undefined,
): string | undefined {
	if (plan === undefined) {
		return undefined;
	}
	if (plan === null) {
		return "unreadable (rerun remediate plan)";
	}
	const done = plan.steps.filter((step) => step.status === "done").length;
	const next = plan.steps.find((step) => step.status !== "done");
	return next === undefined || typeof next.id !== "string"
		? `${done}/${plan.steps.length} done`
		: `${done}/${plan.steps.length} done, next ${next.id}`;
}

export async function collectHealthFields(
	root: string,
	events: ReadonlyArray<EventLogLine>,
	now: string,
): Promise<HealthFields> {
	const task = await activeTask(root);
	const waiverText = await readStateText(root, ".codictator/waivers.json");
	const baselineText = await readStateText(root, ".codictator/baseline.json");
	const snapshotText = await readStateText(
		root,
		".codictator/registry-snapshot.json",
	);
	const plan = await readRemediationPlan(root);
	const escalations = events.filter((event) => event.kind === "escalation");
	return {
		...(task === undefined ? {} : { task: taskLine(task) }),
		...(waiverText === undefined
			? {}
			: { waivers: waiversField(waiverRowsOf(waiverText)) }),
		...(() => {
			const ratchet = ratchetField(baselineText, events);
			return ratchet === undefined ? {} : { ratchet };
		})(),
		...(() => {
			const deps = depsField(snapshotText, now);
			return deps === undefined ? {} : { deps };
		})(),
		...(task === undefined ? {} : { integrity: integrityField(task) }),
		...(escalations.length === 0
			? {}
			: { escalations: `${escalations.length} recorded` }),
		...(() => {
			const remediation = remediationField(plan);
			return remediation === undefined ? {} : { remediation };
		})(),
	};
}
