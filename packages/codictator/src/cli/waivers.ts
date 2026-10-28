// SPEC §4.19.2 + §4.3.4: waive a tunable with reason, expiry and optional
// scope. Floor rules refuse as CDX-E103; values beyond the pack bound as
// CDX-E109; rules no loaded pack owns fail closed as CDX-E903.
import { parseArgs } from "node:util";
import { MAX_WAIVER_DAYS, type Waiver } from "../features/engine/index.ts";
import { loadBuiltinPack } from "../features/packs/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok, parseJson, stableStringify } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
	fail,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	readStateText,
	usageError,
	writeStateText,
} from "./shared.ts";

const WAIVE_USAGE =
	"usage: codictator waive <rule> --set k=v ... --reason <t> --expires <yyyy-mm-dd> [--paths ...] [--renews <id>]";

function dateOnly(now: string): string {
	return now.slice(0, "2026-01-02".length);
}

interface WaiveFlags {
	readonly rule: string;
	readonly sets: ReadonlyArray<string>;
	readonly reason: string;
	readonly expires: string;
	readonly paths: ReadonlyArray<string>;
	readonly renews: string | undefined;
}

function parseWaiveFlags(args: ReadonlyArray<string>): WaiveFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {
				set: { type: "string", multiple: true, default: [] },
				reason: { type: "string" },
				expires: { type: "string" },
				paths: { type: "string", multiple: true, default: [] },
				renews: { type: "string" },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length !== 1) {
			return undefined;
		}
		return {
			rule: parsed.positionals[0] ?? "",
			sets: [...(parsed.values.set ?? [])],
			reason: parsed.values.reason ?? "",
			expires: parsed.values.expires ?? "",
			paths: [...(parsed.values.paths ?? [])],
			renews: parsed.values.renews,
		};
	} catch {
		return undefined;
	}
}

// SPEC §4.3.4: the floor and bound gates over loaded pack data. A rule no
// loaded pack owns fails closed as CDX-E903: its tier cannot be verified.
async function checkWaiveBounds(
	rule: string,
	params: Readonly<Record<string, unknown>>,
	req: CommandRequest,
): Promise<Result<number>> {
	let knownRule = false;
	for (const id of ["core", "typescript", "dotnet", "python"]) {
		const loaded = await loadBuiltinPack(id);
		if (!loaded.ok) {
			continue;
		}
		for (const candidate of loaded.value.manifest.rules) {
			if (candidate.id !== rule) {
				continue;
			}
			knownRule = true;
			if (candidate.tier === "floor") {
				return fail(
					"CDX-E103",
					`waiver of floor rule ${rule} refused`,
					"Floor rules cannot be loosened; fix the violation instead.",
					req.json,
				);
			}
			for (const [name, value] of Object.entries(params)) {
				const spec = candidate.params[name];
				if (spec === undefined) {
					continue;
				}
				const bound = Number(spec.bound);
				const seen = Number(value);
				const outside =
					typeof value === "number" &&
					Number.isFinite(bound) &&
					Number.isFinite(seen) &&
					((spec.stricter === "lower" && seen > bound) ||
						(spec.stricter === "higher" && seen < bound));
				if (outside) {
					return fail(
						"CDX-E109",
						`waiver value ${name}=${seen} is beyond the pack bound ${bound}`,
						"Bring the value inside the pack bound, then retry.",
						req.json,
					);
				}
			}
		}
	}
	if (!knownRule) {
		return fail(
			"CDX-E903",
			`rule "${rule}" is not in a loaded pack; its tier cannot be verified`,
			"Use a rule id from a loaded pack, then retry.",
			req.json,
		);
	}
	return ok(0);
}

async function readKnownWaivers(root: string): Promise<Array<Waiver>> {
	const existing = await readStateText(root, ".codictator/waivers.json");
	const known: Array<Waiver> = [];
	if (existing === undefined) {
		return known;
	}
	const parsed = parseJson(existing);
	const value = parsed.ok ? parsed.value : undefined;
	const list = Array.isArray(value)
		? value
		: typeof value === "object" &&
				value !== null &&
				Array.isArray((value as { waivers?: unknown }).waivers)
			? (value as { waivers: Array<Waiver> }).waivers
			: [];
	for (const entry of list) {
		known.push(entry);
	}
	return known;
}

function buildWaiverParams(
	sets: ReadonlyArray<string>,
): Record<string, unknown> | undefined {
	const params: Record<string, unknown> = {};
	for (const entry of sets) {
		const at = entry.indexOf("=");
		if (at < 1) {
			return undefined;
		}
		const raw = entry.slice(at + 1);
		const numeric = Number(raw);
		params[entry.slice(0, at)] =
			raw !== "" && Number.isFinite(numeric) ? numeric : raw;
	}
	return params;
}

async function writeWaiverFile(
	root: string,
	fields: {
		rule: string;
		params: Record<string, unknown>;
		paths: ReadonlyArray<string>;
		reason: string;
		expires: string;
		renews: string | undefined;
		now: string;
	},
	req: CommandRequest,
): Promise<Result<Waiver>> {
	const known = await readKnownWaivers(root);
	if (
		fields.renews !== undefined &&
		!known.some((entry) => entry.id === fields.renews)
	) {
		return fail(
			"CDX-E110",
			`renewal target ${fields.renews} is not a known waiver`,
			"Renew an existing waiver id, then retry.",
			req.json,
		);
	}
	const waiver: Waiver = {
		id: `W-${String(known.length + 1).padStart(4, "0")}`,
		rule: fields.rule,
		params: fields.params,
		paths: [...fields.paths],
		reason: fields.reason,
		created: dateOnly(fields.now),
		expires: fields.expires,
		createdBy: "human",
	};
	const saved = await writeStateText(
		root,
		".codictator/waivers.json",
		`${stableStringify({ version: 1, maxWaiverDays: MAX_WAIVER_DAYS, waivers: [...known, waiver] })}\n`,
	);
	if (!saved.ok) {
		return fail(
			"CDX-E903",
			saved.error.message,
			saved.error.remediation,
			req.json,
		);
	}
	return ok(waiver);
}

// SPEC §4.3.4: waive a tunable with reason, expiry and optional scope.
// Human-only; floor rules and out-of-bound values fail with their row.
export async function handleWaive(
	req: CommandRequest,
): Promise<Result<number>> {
	const human = checkHuman(commandEnv(), []);
	if (!human.ok) {
		return fail(
			"CDX-E107",
			human.error.message,
			human.error.remediation,
			req.json,
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const flags = parseWaiveFlags(req.args);
	if (
		flags === undefined ||
		flags.rule === "" ||
		flags.reason === "" ||
		!/^\d{4}-\d{2}-\d{2}$/.test(flags.expires)
	) {
		return usageError(WAIVE_USAGE);
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
	const now = ports.value.clock.now();
	if (flags.expires <= dateOnly(now)) {
		return fail(
			"CDX-E110",
			`waiver expiry ${flags.expires} is not in the future`,
			"Pick an expiry within maxWaiverDays, then retry.",
			req.json,
		);
	}
	const params = buildWaiverParams(flags.sets);
	if (params === undefined) {
		return usageError(WAIVE_USAGE);
	}
	const gated = await checkWaiveBounds(flags.rule, params, req);
	if (!gated.ok) {
		return gated;
	}
	const written = await writeWaiverFile(
		root,
		{
			rule: flags.rule,
			params,
			paths: flags.paths,
			reason: flags.reason,
			expires: flags.expires,
			renews: flags.renews,
			now,
		},
		req,
	);
	if (!written.ok) {
		return written;
	}
	if (req.json) {
		printJson({
			waived: written.value.id,
			rule: flags.rule,
			expires: flags.expires,
		});
	} else {
		printHuman(
			`waived ${flags.rule} as ${written.value.id} until ${flags.expires}`,
			req.quiet,
		);
	}
	return ok(0);
}
