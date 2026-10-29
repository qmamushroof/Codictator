// SPEC §4.14.2 + §4.18.3 + §4.19.2: verify and status. Verify evaluates
// the manifest drift and blocks on findings; status renders the
// agent-readable screen (or --json for the extension).
import { parseArgs } from "node:util";
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
	buildStatusText,
	type EventLogLine,
	type HarnessStatus,
	readEvents,
} from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import type { Finding, Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { driftFindings } from "./drift.ts";
import { evaluateScope, resolveVerifyScope } from "./evaluate.ts";
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

export function printFinding(finding: Finding, quiet: boolean): void {
	const where =
		finding.path === undefined
			? ""
			: `  ${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}`;
	printHuman(`${finding.ruleId}${where}  ${finding.message}`, quiet);
	printHuman(`Do instead: ${finding.remediation}`, quiet);
}

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

const LAYERS: ReadonlySet<string> = new Set(["L1", "L2", "L3", "L4", "L5"]);

interface VerifyFlags {
	readonly staged: boolean;
	readonly all: boolean;
	readonly base: string | undefined;
	readonly head: string | undefined;
	readonly layer: string | undefined;
}

function parseVerifyFlags(
	args: ReadonlyArray<string>,
): VerifyFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {
				staged: { type: "boolean", default: false },
				all: { type: "boolean", default: false },
				base: { type: "string" },
				head: { type: "string" },
				layer: { type: "string" },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if (parsed.values.layer !== undefined && !LAYERS.has(parsed.values.layer)) {
			return undefined;
		}
		if (
			(parsed.values.base === undefined) !==
			(parsed.values.head === undefined)
		) {
			return undefined;
		}
		return {
			staged: parsed.values.staged ?? false,
			all: parsed.values.all ?? false,
			base: parsed.values.base,
			head: parsed.values.head,
			layer: parsed.values.layer,
		};
	} catch {
		return undefined;
	}
}

function emitVerify(
	req: CommandRequest,
	findings: ReadonlyArray<Finding>,
	configHash: string,
	note: string,
): Result<number> {
	if (req.json) {
		printJson({
			decision: findings.length === 0 ? "allow" : "block",
			findings,
			configHash,
			note,
		});
	} else {
		for (const finding of findings) {
			printFinding(finding, req.quiet);
		}
		if (findings.length === 0) {
			printHuman(`verify: pass (${note})`, req.quiet);
		}
	}
	return findings.length === 0 ? ok(0) : ok(1);
}

// SPEC §4.19.2: evaluate a trigger scope; findings block (exit 1), an
// advise-only or clean run passes (exit 0).
export async function handleVerify(
	req: CommandRequest,
): Promise<Result<number>> {
	const flags = parseVerifyFlags(req.args);
	if (flags === undefined) {
		return usageError(
			"usage: codictator verify [--staged | --base <ref> --head <ref> | --all] [--layer L1..L5]",
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const configured = await loadRepoConfig(root);
	if (!configured.ok) {
		return fail(
			configured.error.code,
			configured.error.message,
			"Fix .codictator/config.json, then retry.",
			req.json,
		);
	}
	const drifted = await driftFindings(root, flags.layer);
	const scoped = await resolveVerifyScope(configured.value.ports, flags);
	if (!scoped.ok) {
		return fail(
			scoped.error.code,
			scoped.error.message,
			scoped.error.remediation,
			req.json,
		);
	}
	const evaluated = await evaluateScope(
		configured.value.ports,
		configured.value.effective.config.packs.map((entry) => entry.id),
		scoped.value,
		configured.value.ports.clock.now(),
		configured.value.effective.configHash,
	);
	if (!evaluated.ok) {
		return fail(
			evaluated.error.code,
			evaluated.error.message,
			evaluated.error.remediation,
			req.json,
		);
	}
	return emitVerify(
		req,
		[...drifted.findings, ...evaluated.value],
		configured.value.effective.configHash,
		`${drifted.note}; ${scoped.value.note}`,
	);
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
}

async function collectStatusParts(root: string): Promise<StatusParts> {
	const log = await readLogEvents(root);
	const events = log?.events ?? [];
	const observed = new Set(
		events.map((event) => event.harness ?? "").filter((h) => h !== ""),
	);
	const packs: Record<string, string> = {};
	const configured = await loadRepoConfig(root);
	if (configured.ok) {
		for (const pack of configured.value.effective.config.packs) {
			packs[pack.id] =
				typeof pack.version === "string" ? pack.version : "unpinned";
		}
	}
	return { events, corrupt: log?.corrupt ?? 0, observed, packs };
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
