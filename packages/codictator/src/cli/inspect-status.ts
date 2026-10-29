// SPEC §4.18.3: the status screen. Split from the verify command
// (inspect.ts) by responsibility: read-only screen here, trigger evaluation
// there. The event log, config and ports stay caller-owned.
import { parseArgs } from "node:util";
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
} from "../features/audit/index.ts";
import {
	buildStatusJson,
	buildStatusText,
	readEvents,
} from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { REQUIRED_HELPERS_DEFAULT } from "../features/steering/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	loadRepoConfig,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";

// SPEC §4.18.1: the repo's event lines through caller-owned ports against
// the logical root "." (the Fs port takes repo-relative paths only).
export async function readLogEvents(
	root: string,
): Promise<
	{ events: ReadonlyArray<EventLogLine>; corrupt: number } | undefined
> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return undefined;
	}
	const read = await readEvents(ports.value, ".");
	return read.ok ? read.value : undefined;
}

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

interface StatusParts {
	readonly events: ReadonlyArray<EventLogLine>;
	readonly corrupt: number;
	readonly observed: ReadonlySet<string>;
	readonly packs: Record<string, string>;
	readonly helpers: ReadonlyArray<HelperStatus>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// SPEC §4.6.6: the required helper roles come from config.steering, falling
// back to the pack default; a role is present when config.tools declares it
// (by role or id) at an exact pin.
function requiredRoles(steering: unknown): ReadonlyArray<string> {
	if (isRecord(steering)) {
		const key = "requiredHelpers";
		const found = steering[key];
		if (
			Array.isArray(found) &&
			found.every((entry) => typeof entry === "string")
		) {
			return [...found];
		}
	}
	return [...REQUIRED_HELPERS_DEFAULT];
}

function matchHelper(entry: unknown, role: string): HelperStatus | undefined {
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

function helperDetail(tools: unknown, role: string): HelperStatus {
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

async function collectStatusParts(root: string): Promise<StatusParts> {
	const log = await readLogEvents(root);
	const events = log?.events ?? [];
	const observed = new Set(
		events.map((event) => event.harness ?? "").filter((h) => h !== ""),
	);
	const packs: Record<string, string> = {};
	let helpers: ReadonlyArray<HelperStatus> = [];
	const configured = await loadRepoConfig(root);
	if (configured.ok) {
		for (const pack of configured.value.effective.config.packs) {
			packs[pack.id] =
				typeof pack.version === "string" ? pack.version : "unpinned";
		}
		helpers = requiredRoles(configured.value.effective.config.steering).map(
			(role) => helperDetail(configured.value.effective.config.tools, role),
		);
	}
	return { events, corrupt: log?.corrupt ?? 0, observed, packs, helpers };
}

function terseArgs(args: ReadonlyArray<string>, count: number): boolean {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {},
			allowPositionals: true,
		});
		return parsed.positionals.length === count;
	} catch {
		return false;
	}
}

// SPEC §4.18.3: one screen with engine, packs, harness states, task, waivers,
// ratchet, deps, integrity, escalations and remediation progress.
export async function handleStatus(
	req: CommandRequest,
): Promise<Result<number>> {
	if (!terseArgs(req.args, 0)) {
		return usageError("usage: codictator status");
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const parts = await collectStatusParts(root);
	const input = {
		engineVersion: ENGINE_VERSION,
		packs: parts.packs,
		harnesses: harnessStates(parts.observed),
		helpers: parts.helpers,
		events: parts.events.length,
		corrupt: parts.corrupt,
		gap: parts.events.length === 0,
		task: undefined,
		waivers: undefined,
		ratchet: undefined,
		deps: undefined,
		integrity: undefined,
		escalations: undefined,
		remediation: undefined,
		now: ports.value.clock.now(),
	};
	if (req.json) {
		printJson(buildStatusJson(input));
	} else {
		printHuman(buildStatusText(input), req.quiet);
	}
	return ok(0);
}
