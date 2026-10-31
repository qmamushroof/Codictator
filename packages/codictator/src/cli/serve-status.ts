// SPEC §7.15 + §4.18.3: the stdio `status` row. Answers the §4.18.3 JSON
// over the same inputs the `status` command renders: engine, packs,
// harness states, helper tools, event counts and the pending sections.
import {
	CLAUDE_CODE_CAPABILITIES,
	CODEX_CAPABILITIES,
	COPILOT_CAPABILITIES,
	MUSE_CAPABILITIES,
	OPENCODE_CAPABILITIES,
	UNIVERSAL_CAPABILITIES,
} from "../features/adapters/index.ts";
import {
	buildStatusJson,
	type HarnessStatus,
	type HelperStatus,
	summarizeTokenSaverEvidence,
	tokenSaverHelper,
} from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { REQUIRED_HELPERS_DEFAULT } from "../features/steering/index.ts";
import { readLogEvents } from "./inspect.ts";
import {
	field,
	isRecord,
	type MethodContext,
	type MethodOutcome,
	methodOk,
	resolveRoot,
} from "./serve-shared.ts";
import { loadRepoConfig, portsFor } from "./shared.ts";

function harnessStates(observed: ReadonlySet<string>): Array<HarnessStatus> {
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

function matchHelper(
	entry: Record<string, unknown>,
	role: string,
): HelperStatus | undefined {
	const entryId = field(entry, "id");
	const entryRole = field(entry, "role");
	if (entryId !== role && entryRole !== role) {
		return undefined;
	}
	const version = field(entry, "version");
	const versionPin = isRecord(version) ? field(version, "pin") : undefined;
	const pin = typeof versionPin === "string" ? versionPin : undefined;
	if (typeof entryId === "string" && pin !== undefined && pin !== "") {
		return { role, present: true, detail: `${entryId} ${pin}` };
	}
	return { role, present: false };
}

function helperDetail(tools: unknown, role: string): HelperStatus {
	if (!Array.isArray(tools)) {
		return { role, present: false };
	}
	for (const entry of tools) {
		if (!isRecord(entry)) {
			continue;
		}
		const matched = matchHelper(entry, role);
		if (matched !== undefined) {
			return matched;
		}
	}
	return { role, present: false };
}

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

interface StatusParts {
	readonly events: number;
	readonly corrupt: number;
	readonly gap: boolean;
	readonly observed: ReadonlySet<string>;
	readonly packs: Record<string, string>;
	readonly helpers: Array<HelperStatus>;
}

async function collectStatusParts(root: string): Promise<StatusParts> {
	const log = await readLogEvents(root);
	const events = log?.events ?? [];
	const packs: Record<string, string> = {};
	let helpers: Array<HelperStatus> = [];
	const configured = await loadRepoConfig(root);
	if (configured.ok) {
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
	}
	return {
		events: events.length,
		corrupt: log?.corrupt ?? 0,
		gap: events.length === 0,
		observed: new Set(
			events.map((event) => event.harness ?? "").filter((h) => h !== ""),
		),
		packs,
		helpers,
	};
}

export async function statusMethod(ctx: MethodContext): Promise<MethodOutcome> {
	const root = await resolveRoot(ctx.root);
	const ports = await portsFor(root);
	if (!ports.ok) {
		return {
			ok: false,
			error: {
				code: -32000,
				message: `${ports.error.code} ${ports.error.message}`,
				data: {
					code: ports.error.code,
					remediation: ports.error.remediation,
				},
			},
		};
	}
	const parts = await collectStatusParts(root);
	return methodOk(
		buildStatusJson({
			engineVersion: ENGINE_VERSION,
			packs: parts.packs,
			harnesses: harnessStates(parts.observed),
			helpers: parts.helpers,
			events: parts.events,
			corrupt: parts.corrupt,
			gap: parts.gap,
			task: undefined,
			waivers: undefined,
			ratchet: undefined,
			deps: undefined,
			integrity: undefined,
			escalations: undefined,
			remediation: undefined,
			now: ports.value.clock.now(),
		}),
	);
}
