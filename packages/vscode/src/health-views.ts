// SPEC §4.20.2: Health — ratchet trend, dependency freshness, integrity
// and remediation progress, over `status`. This module owns the shaping;
// p1-views.ts keeps Steering and Budget.
import type { EngineRequest } from "./engine-client.ts";
import { engineRequestFor, stringFieldOf } from "./engine-client.ts";

// SPEC §4.20.2 Health: ratchet trend, dependency freshness, integrity and
// remediation progress, over `status`.
export interface HealthState {
	readonly ratchet: string;
	readonly dependencies: string;
	readonly integrity: string;
	readonly remediation: string;
	// SPEC §4.20.2 PR4: the extra status rows when the engine reports them.
	readonly task?: string;
	readonly waivers?: string;
	readonly escalations?: string;
}

// SPEC §4.20.2 PR4: one health row — the field value with its state icon
// and, where the repair is human-only or engine-side, the command id.
export interface HealthRow {
	readonly label: string;
	readonly icon: string;
	readonly action?: string;
}

// SPEC §4.20.2 PR4: the state icon per health value. Fresh and clean read
// `$(check)`, failures `$(error)`, everything unknown `$(warning)`.
function healthIcon(value: string): string {
	if (/fail|error|breach|stale|expired/i.test(value)) {
		return "$(error)";
	}
	if (
		/^(fresh|clean|healthy|complete|current|verified|ok|pass|passed)\b/i.test(
			value,
		)
	) {
		return "$(check)";
	}
	return "$(warning)";
}

// One row from a name, value and optional repair action.
function healthRow(name: string, value: string, action?: string): HealthRow {
	const row: { action?: string; icon: string; label: string } = {
		icon: healthIcon(value),
		label: `${name}: ${value}`,
	};
	if (action !== undefined) {
		row.action = action;
	}
	return row;
}

// SPEC §4.20.2 PR4: the Health rows — ratchet, dependencies, integrity,
// remediation plus the task, waiver and escalation rows when present. Each
// row carries its state icon and the repair action: baseline capture runs
// in a human-only terminal, deps check and next remediation in the engine.
export function healthRows(state: HealthState): Array<HealthRow> {
	const rows: Array<HealthRow> = [
		healthRow("ratchet", state.ratchet, "codictator.captureBaseline"),
		healthRow("dependencies", state.dependencies, "codictator.depsCheck"),
		healthRow("integrity", state.integrity),
		healthRow("remediation", state.remediation, "codictator.remediateNext"),
	];
	if (state.task !== undefined) {
		rows.push(healthRow("task", state.task, "codictator.taskShow"));
	}
	if (state.waivers !== undefined) {
		rows.push(healthRow("waivers", state.waivers, "codictator.waive"));
	}
	if (state.escalations !== undefined) {
		rows.push(healthRow("escalations", state.escalations, "codictator.status"));
	}
	return rows;
}

// SPEC §4.20.2: Health view data over `status` — ratchet trend, dependency
// freshness, integrity and remediation progress. Absent sections read the
// same defaults the `status` text renders (§4.18.3), so the view stays
// live-shaped on an empty log.
export async function healthSummary(
	folderPath: string,
	request?: EngineRequest,
): Promise<HealthState> {
	const answer = await engineRequestFor(request)(folderPath, "status", {});
	const task = stringFieldOf(answer, "task");
	const waivers = stringFieldOf(answer, "waivers");
	const escalations = stringFieldOf(answer, "escalations");
	const summary: {
		dependencies: string;
		escalations?: string;
		integrity: string;
		ratchet: string;
		remediation: string;
		task?: string;
		waivers?: string;
	} = {
		dependencies: stringFieldOf(answer, "deps") ?? "freshness unknown",
		integrity: stringFieldOf(answer, "integrity") ?? "unverified",
		ratchet: stringFieldOf(answer, "ratchet") ?? "no baseline history",
		remediation: stringFieldOf(answer, "remediation") ?? "no plan",
	};
	if (task !== undefined) {
		summary.task = task;
	}
	if (waivers !== undefined) {
		summary.waivers = waivers;
	}
	if (escalations !== undefined) {
		summary.escalations = escalations;
	}
	return summary;
}
