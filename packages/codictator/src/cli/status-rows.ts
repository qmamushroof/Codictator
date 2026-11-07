// Shared status-row builders (core/duplication): the harness-state,
// helper-detail and pack-pin rows render identically on the status screen
// and the stdio row, so both surfaces import them instead of copying them.
// Malformed helper entries never match: a missing or empty id skips the
// entry instead of reporting a phantom present row.
import {
	CLAUDE_CODE_CAPABILITIES,
	CODEX_CAPABILITIES,
	COPILOT_CAPABILITIES,
	MUSE_CAPABILITIES,
	OPENCODE_CAPABILITIES,
	UNIVERSAL_CAPABILITIES,
} from "../features/adapters/index.ts";
import type {
	EventLogLine,
	HarnessStatus,
	HelperStatus,
	StatusInput,
} from "../features/audit/index.ts";
import {
	summarizeTokenSaverEvidence,
	tokenSaverHelper,
} from "../features/audit/index.ts";
import { REQUIRED_HELPERS_DEFAULT } from "../features/steering/index.ts";
import { collectHealthFields, type HealthFields } from "./inspect-health.ts";
import { field, isRecord } from "./serve-shared.ts";
import { loadRepoConfig } from "./shared.ts";

export function harnessStates(
	observed: ReadonlySet<string>,
): Array<HarnessStatus> {
	const declarations = [
		MUSE_CAPABILITIES,
		UNIVERSAL_CAPABILITIES,
		CLAUDE_CODE_CAPABILITIES,
		COPILOT_CAPABILITIES,
		CODEX_CAPABILITIES,
		OPENCODE_CAPABILITIES,
	];
	return declarations.map((candidate) => ({
		harness: candidate.harness,
		state: observed.has(candidate.harness)
			? ("active" as const)
			: ("unverified" as const),
		layers: `L0:${candidate.layers.L0} L1:${candidate.layers.L1} L2:${candidate.layers.L2} L3:${candidate.layers.L3} L4:${candidate.layers.L4} L5:${candidate.layers.L5}`,
	}));
}

export function matchHelper(
	entry: unknown,
	role: string,
): HelperStatus | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}
	const idKey = "id";
	const roleKey = "role";
	const versionKey = "version";
	const pinKey = "pin";
	const id = entry[idKey];
	if (typeof id !== "string" || id === "") {
		return undefined;
	}
	if (entry[roleKey] !== role && id !== role) {
		return undefined;
	}
	const version = entry[versionKey];
	const pin = isRecord(version) ? version[pinKey] : undefined;
	if (typeof pin === "string" && pin !== "") {
		return { role, present: true, detail: `${id} ${pin}` };
	}
	return { role, present: false };
}

export function helperDetail(tools: unknown, role: string): HelperStatus {
	if (!Array.isArray(tools)) {
		return { role, present: false };
	}
	for (const entry of tools) {
		const matched = matchHelper(entry, role);
		if (matched !== undefined) {
			return matched;
		}
	}
	return { role, present: false };
}

// SPEC §4.6.6: the required helper roles come from config.steering,
// falling back to the pack default.
function requiredRoles(steering: unknown): ReadonlyArray<string> {
	if (isRecord(steering)) {
		const found = field(steering, "requiredHelpers");
		if (
			Array.isArray(found) &&
			found.every((entry) => typeof entry === "string")
		) {
			return [...found];
		}
	}
	return [...REQUIRED_HELPERS_DEFAULT];
}

export interface PackRows {
	readonly packs: Record<string, string>;
	readonly helpers: ReadonlyArray<HelperStatus>;
}

// SPEC §4.18.3 D9: the configured pack pins and required helper rows,
// shared by the status screen and the stdio row. A missing config reads
// empty; the token-saver role carries live engine evidence instead of a
// binary probe (§4.6.6).
export async function configPackRows(
	root: string,
	engineVersion: string,
	events: ReadonlyArray<EventLogLine>,
): Promise<PackRows> {
	const packs: Record<string, string> = {};
	let helpers: ReadonlyArray<HelperStatus> = [];
	const configured = await loadRepoConfig(root, undefined, engineVersion);
	if (!configured.ok) {
		return { packs, helpers };
	}
	for (const pack of configured.value.effective.config.packs) {
		packs[pack.id] =
			typeof pack.version === "string" ? pack.version : "unpinned";
	}
	helpers = requiredRoles(configured.value.effective.config.steering).map(
		(role) => helperDetail(configured.value.effective.config.tools, role),
	);
	// SPEC §4.6.6 + §4.18.3: the token-saver role is satisfied by the
	// engine itself, so with no external pin the row carries live
	// evidence instead of probing a binary. All-absent evidence reads
	// missing: a finding, not a pass.
	helpers = helpers.map((helper) =>
		helper.role === "token-saver" && !helper.present
			? tokenSaverHelper(summarizeTokenSaverEvidence(events))
			: helper,
	);
	return { packs, helpers };
}

export interface StatusFrame {
	readonly packs: Record<string, string>;
	readonly observed: ReadonlySet<string>;
	readonly helpers: ReadonlyArray<HelperStatus>;
	readonly events: ReadonlyArray<EventLogLine>;
	readonly corrupt: number;
	readonly health: HealthFields;
}

// SPEC §4.18.3 D9: one assembly for the status screen and the stdio row,
// so both surfaces share the pack pins, helper rows and health fields.
// The log read stays with the callers (ports are caller-owned); the
// observed-harness set, pack rows and health fields build here once.
export async function collectStatusFrame(
	root: string,
	engineVersion: string,
	events: ReadonlyArray<EventLogLine>,
	corrupt: number,
	now: string,
): Promise<StatusFrame> {
	const rows = await configPackRows(root, engineVersion, events);
	const health = await collectHealthFields(root, events, now);
	return {
		packs: rows.packs,
		observed: new Set(
			events.map((event) => event.harness ?? "").filter((h) => h !== ""),
		),
		helpers: rows.helpers,
		events,
		corrupt,
		health,
	};
}

// SPEC §4.18.3: one assembly for the status JSON and the human screen,
// so the stdio row and the screen never drift apart field by field.
export function statusInput(
	frame: StatusFrame,
	engineVersion: string,
	now: string,
): StatusInput {
	return {
		engineVersion,
		packs: frame.packs,
		harnesses: harnessStates(frame.observed),
		helpers: frame.helpers,
		events: frame.events.length,
		corrupt: frame.corrupt,
		gap: frame.events.length === 0,
		...frame.health,
		now,
	};
}
