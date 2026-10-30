// SPEC §7.15: stdio query methods. Read-only protocol rows built on the
// same surfaces the CLI commands use (pack registry, explain), imported
// through their public index.ts entries (§3.3). Status lives in
// serve-status.ts; `run` in serve-run.ts; evaluation rows in serve-eval.ts.
import {
	errorRowFor,
	explainCodeText,
	explainUnknownText,
	replaySummary,
} from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { loadBuiltinPack } from "../features/packs/index.ts";
import type { PackRule, PackRuleParam } from "../kernel/index.ts";
import { parseJson } from "../kernel/index.ts";
import { readLogEvents } from "./inspect.ts";
import { dispatchEvalMethod } from "./serve-eval.ts";
import {
	invalidParamsError,
	methodNotFoundError,
	serverError,
} from "./serve-protocol.ts";
import {
	field,
	isRecord,
	type MethodContext,
	type MethodOutcome,
	methodOk,
	resolveRoot,
} from "./serve-shared.ts";
import { statusMethod } from "./serve-status.ts";
import { loadRepoConfig, readStateText } from "./shared.ts";

function methodMissing(detail: string): MethodOutcome {
	return { ok: false, error: invalidParamsError(detail) };
}

function stringField(params: unknown, name: string): string | undefined {
	if (!isRecord(params)) {
		return undefined;
	}
	const found = field(params, name);
	return typeof found === "string" ? found : undefined;
}

interface WaiverRow {
	readonly rule: string;
	readonly row: Record<string, unknown>;
}

async function waiverRows(root: string): Promise<Array<WaiverRow>> {
	const text = await readStateText(root, ".codictator/waivers.json");
	if (text === undefined) {
		return [];
	}
	const parsed = parseJson(text);
	if (!parsed.ok || !isRecord(parsed.value)) {
		return [];
	}
	const listed = field(parsed.value, "waivers");
	if (!Array.isArray(listed)) {
		return [];
	}
	const rows: Array<WaiverRow> = [];
	for (const entry of listed) {
		if (!isRecord(entry)) {
			continue;
		}
		const rule = field(entry, "rule");
		if (typeof rule === "string" && rule !== "") {
			rows.push({ rule, row: entry });
		}
	}
	return rows;
}

// The tunables overlay for one rule: pack defaults with config values
// where the human tuned them.
function effectiveParams(
	defaults: Readonly<Record<string, PackRuleParam>>,
	tuned: unknown,
): Record<string, unknown> {
	const rawParams = isRecord(tuned) ? field(tuned, "params") : undefined;
	const tunedParams = isRecord(rawParams) ? rawParams : {};
	const params: Record<string, unknown> = {};
	for (const [name, param] of Object.entries(defaults)) {
		params[name] = {
			default: param.default,
			bound: param.bound,
			effective:
				tunedParams[name] === undefined ? param.default : tunedParams[name],
		};
	}
	return params;
}

function ruleRow(
	rule: PackRule,
	pack: string,
	tunables: Readonly<Record<string, unknown>>,
	waivers: ReadonlyArray<WaiverRow>,
): Record<string, unknown> {
	return {
		id: rule.id,
		pack,
		statement: rule.statement,
		reason: rule.reason,
		tier: rule.tier,
		family: rule.family,
		params: effectiveParams(rule.params, tunables[rule.id]),
		waivers: waivers
			.filter((entry) => entry.rule === rule.id)
			.map((entry) => entry.row),
		coverage: "per-harness capability declarations; see codictator status",
	};
}

// SPEC §7.15: `rules/list` answers rules with effective params, waivers
// and coverage. Effective params overlay config tunables on pack defaults.
async function rulesListMethod(ctx: MethodContext): Promise<MethodOutcome> {
	const root = await resolveRoot(ctx.root);
	const configured = await loadRepoConfig(root);
	// Tunables are optional in a repo config (§4.2 validation), so a
	// missing section defaults before indexing by rule id.
	const configuredTunables =
		configured.ok === true ? configured.value.effective.config.tunables : {};
	const tunables = configuredTunables ?? {};
	const waivers = await waiverRows(root);
	const rules: Array<Record<string, unknown>> = [];
	for (const id of ["core", "typescript", "dotnet", "python"]) {
		const loaded = await loadBuiltinPack(id);
		if (!loaded.ok) {
			continue;
		}
		const pack = `${loaded.value.manifest.id}@${loaded.value.manifest.version}`;
		for (const rule of loaded.value.manifest.rules) {
			rules.push(ruleRow(rule, pack, tunables, waivers));
		}
	}
	return methodOk({ rules });
}

// SPEC §4.18.2 + §7.15: `explain` answers the rule, event or error detail;
// unknown ids fail as CDX-E010 with the nearest known ids.
async function explainMethod(
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome> {
	const id = stringField(params, "id");
	if (id === undefined || id === "") {
		return methodMissing("explain params must be { id: string }");
	}
	const coded = errorRowFor(id);
	if (coded !== undefined) {
		return methodOk({
			kind: "error",
			code: coded.code,
			exit: coded.exit,
			meaning: coded.meaning,
			remediation: coded.remediation,
			text: explainCodeText(coded),
		});
	}
	if (id.includes("/")) {
		for (const packId of ["core", "typescript", "dotnet", "python"]) {
			const loaded = await loadBuiltinPack(packId);
			if (!loaded.ok) {
				continue;
			}
			for (const rule of loaded.value.manifest.rules) {
				if (rule.id !== id) {
					continue;
				}
				return methodOk({
					kind: "rule",
					rule: rule.id,
					pack: `${loaded.value.manifest.id}@${loaded.value.manifest.version}`,
					statement: rule.statement,
					remediation: rule.remediation,
				});
			}
		}
	}
	const root = await resolveRoot(ctx.root);
	const log = await readLogEvents(root);
	const event = log?.events.find((candidate) => candidate.id === id);
	if (event !== undefined) {
		return methodOk({ kind: "event", event: id, text: replaySummary(event) });
	}
	return {
		ok: false,
		error: serverError(
			"CDX-E010",
			`unknown rule, event or error id "${id}"`,
			"Check the spelling; the nearest known ids were listed.",
			{ id, text: explainUnknownText(id) },
		),
	};
}

// SPEC §7.15: the read-row dispatch. `run` is owned by serve-run.ts; the
// evaluation rows by serve-eval.ts; status by serve-status.ts.
export async function dispatchMethod(
	method: string,
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome> {
	switch (method) {
		case "initialize": {
			const root = await resolveRoot(ctx.root);
			return methodOk({
				protocolVersion: 1,
				engineVersion: ENGINE_VERSION,
				root,
			});
		}
		case "status": {
			return statusMethod(ctx);
		}
		case "rules/list": {
			return rulesListMethod(ctx);
		}
		case "explain": {
			return explainMethod(params, ctx);
		}
		default: {
			const handled = await dispatchEvalMethod(method, params, ctx);
			if (handled !== undefined) {
				return handled;
			}
			return { ok: false, error: methodNotFoundError(method) };
		}
	}
}
