// SPEC §4.19.2 + §4.13.1: human-only adoption. Writes config, steering
// block, manifest, CI workflow, hooks and launcher; existing config needs
// --repair, unknown harnesses fail as CDX-E301 via validation.
import { parseArgs } from "node:util";
import { isBuiltinPackId } from "../features/packs/index.ts";
import type { Result } from "../kernel/index.ts";
import {
	buildGuardrailPlan,
	checkFreshConfig,
	defaultHarnesses,
	emitInitResult,
	ensureBaseline,
	type InitFlags,
	initPreamble,
	reportExisting,
} from "./init-plan.ts";
import { KNOWN_HELPER_ROLES, writePlan } from "./plan.ts";
import type { CommandRequest } from "./shared.ts";
import { fail, readStateText, usageError } from "./shared.ts";

const KNOWN_PROFILES: ReadonlySet<string> = new Set([
	"app",
	"library",
	"cli",
	"service",
]);

function parseToolSpec(
	spec: string,
): { role: string; command: string; pin: string } | undefined {
	const eq = spec.indexOf("=");
	if (eq < 0) {
		return undefined;
	}
	const role = spec.slice(0, eq).trim();
	const rest = spec.slice(eq + 1);
	const at = rest.lastIndexOf("@");
	if (at < 0) {
		return undefined;
	}
	const command = rest.slice(0, at).trim();
	const pin = rest.slice(at + 1).trim();
	if (!KNOWN_HELPER_ROLES.has(role) || command === "" || pin === "") {
		return undefined;
	}
	return { role, command, pin };
}

function narrowInitProfile(profile: string | undefined): string | undefined {
	if (profile !== undefined && profile !== "" && !KNOWN_PROFILES.has(profile)) {
		return undefined;
	}
	return profile ?? "";
}

function narrowInitPacks(
	packs: ReadonlyArray<string> | undefined,
): Array<string> | undefined {
	const ids = [...(packs ?? [])];
	if (ids.some((id) => !isBuiltinPackId(id))) {
		return undefined;
	}
	return ids;
}

function narrowInitTools(
	specs: ReadonlyArray<string> | undefined,
): Array<{ role: string; command: string; pin: string }> | undefined {
	const tools: Array<{ role: string; command: string; pin: string }> = [];
	for (const spec of specs ?? []) {
		const tool = parseToolSpec(spec);
		if (tool === undefined) {
			return undefined;
		}
		tools.push(tool);
	}
	return tools;
}

function parseInitFlags(args: ReadonlyArray<string>): InitFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {
				harness: { type: "string", multiple: true, default: [] },
				profile: { type: "string", default: "" },
				pack: { type: "string", multiple: true, default: [] },
				tool: { type: "string", multiple: true, default: [] },
				repair: { type: "boolean", default: false },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		const profile = narrowInitProfile(parsed.values.profile);
		const packs = narrowInitPacks(parsed.values.pack);
		const tools = narrowInitTools(parsed.values.tool);
		if (profile === undefined || packs === undefined || tools === undefined) {
			return undefined;
		}
		return {
			harnesses: [...(parsed.values.harness ?? [])],
			profile,
			packs,
			tools,
			repair: parsed.values.repair ?? false,
		};
	} catch {
		return undefined;
	}
}

const INIT_USAGE =
	"usage: codictator init [--harness <id> ...] [--profile <app|library|cli|service>] [--pack <id> ...] [--tool <role>=<command>@<pin> ...] [--repair]";

export async function handleInit(req: CommandRequest): Promise<Result<number>> {
	const flags = parseInitFlags(req.args);
	if (flags === undefined) {
		return usageError(INIT_USAGE);
	}
	const root = await initPreamble(req);
	if (typeof root !== "string") {
		return root;
	}
	const planned = defaultHarnesses(flags);
	const existing = await readStateText(root, ".codictator/config.json");
	if (existing !== undefined && !flags.repair) {
		return reportExisting(req, root);
	}
	const plan = await buildGuardrailPlan(root, flags, planned);
	const wrote = await writePlan(root, plan);
	if (!wrote.ok) {
		return fail(
			"CDX-E903",
			wrote.error.message,
			wrote.error.remediation,
			req.json,
		);
	}
	const fresh = await checkFreshConfig(root, req);
	if (!fresh.ok) {
		return fresh;
	}
	const baseline = await ensureBaseline(root, req);
	if (!baseline.ok) {
		return fail(
			baseline.error.code,
			baseline.error.message,
			baseline.error.remediation,
			req.json,
		);
	}
	return emitInitResult(req, root, wrote.value, baseline.value);
}
