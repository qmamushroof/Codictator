// SPEC §4.18.2 + §4.19.2: explain and replay. Rules print their pack row,
// events their verdict plus replay, error codes their §8 row; unknown ids
// print CDX-E010 and exit 2.
import { parseArgs } from "node:util";
import type { EventLogLine } from "../features/audit/index.ts";
import {
	errorRowFor,
	explain,
	explainCodeText,
	isKnownExplainId,
	replaySummary,
} from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import { loadBuiltinPack } from "../features/packs/index.ts";
import type { Result } from "../kernel/index.ts";
import { err, makeError, ok } from "../kernel/index.ts";
import { readLogEvents } from "./inspect.ts";
import type { CommandRequest } from "./shared.ts";
import { fail, needRoot, printHuman, printJson, usageError } from "./shared.ts";

// SPEC §4.18.2: a rule prints its pack row. Packs load through the real
// loader; ids no loaded pack owns fall through to the unknown-id path.
async function ruleText(ruleId: string): Promise<string | undefined> {
	for (const id of ["core", "typescript", "dotnet", "python"]) {
		const loaded = await loadBuiltinPack(id);
		if (!loaded.ok) {
			continue;
		}
		for (const rule of loaded.value.manifest.rules) {
			if (rule.id !== ruleId) {
				continue;
			}
			const params = Object.entries(rule.params)
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(
					([name, param]) =>
						`${name}: default ${String(param.default)}, bound ${String(param.bound)}`,
				);
			return [
				`rule ${rule.id} (${loaded.value.manifest.id}@${loaded.value.manifest.version})`,
				`statement: ${rule.statement}`,
				`reason: ${rule.reason}`,
				`tier: ${rule.tier}, family: ${rule.family}, enforcer: ${rule.enforcer}`,
				`params: ${params.length === 0 ? "none" : params.join("; ")}`,
				`remediation: ${rule.remediation}`,
				"coverage: per-harness capability declarations; see codictator status",
			].join("\n");
		}
	}
	return undefined;
}

async function explainEvent(
	root: string,
	target: string,
	req: CommandRequest,
): Promise<Result<number> | undefined> {
	const log = await readLogEvents(root);
	if (log === undefined) {
		return undefined;
	}
	for (const event of log.events) {
		if (event.id !== target) {
			continue;
		}
		const summary = replaySummary(event);
		if (req.json) {
			printJson({ event: target, text: summary });
		} else {
			printHuman(summary, req.quiet);
		}
		return ok(0);
	}
	return undefined;
}

function explainUnknown(
	req: CommandRequest,
	target: string,
	text: Promise<string>,
): Promise<Result<number>> {
	return text.then((resolved) => {
		const unknown = makeError(
			"CDX-E010",
			`unknown rule, event or error id "${target}"`,
			"Check the spelling; the nearest known ids were listed.",
			resolved,
		);
		if (req.json) {
			printJson({ code: unknown.code, id: target, text: resolved });
		} else {
			process.stderr.write(`${resolved}\n`);
		}
		return err(unknown);
	});
}

function explainKnownCode(
	req: CommandRequest,
	target: string,
): Result<number> | undefined {
	const found = errorRowFor(target);
	if (found === undefined) {
		return undefined;
	}
	if (req.json) {
		printJson({
			code: found.code,
			exit: found.exit,
			meaning: found.meaning,
			remediation: found.remediation,
			text: explainCodeText(found),
		});
	} else {
		printHuman(explainCodeText(found), req.quiet);
	}
	return ok(0);
}

// SPEC §4.18.2: Rule prints its row, Event its verdict plus replay, Error
// code its §8 row; unknown ids print CDX-E010 and exit 2.
export async function handleExplain(
	req: CommandRequest,
): Promise<Result<number>> {
	let id: string | undefined;
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length !== 1) {
			return usageError(
				"usage: codictator explain <ruleId | eventId | CDX-Ennn>",
			);
		}
		id = parsed.positionals[0];
	} catch {
		return usageError(
			"usage: codictator explain <ruleId | eventId | CDX-Ennn>",
		);
	}
	const target = id ?? "";
	if (isKnownExplainId(target)) {
		const known = explainKnownCode(req, target);
		if (known !== undefined) {
			return known;
		}
	}
	if (target.includes("/")) {
		const text = await ruleText(target);
		if (text !== undefined) {
			if (req.json) {
				printJson({ rule: target, text });
			} else {
				printHuman(text, req.quiet);
			}
			return ok(0);
		}
	}
	const root = await needRoot(req);
	if (typeof root === "string") {
		const answered = await explainEvent(root, target, req);
		if (answered !== undefined) {
			return answered;
		}
	}
	return explainUnknown(req, target, explain(target));
}

async function findReplayEvent(
	root: string,
	target: string,
): Promise<EventLogLine | undefined> {
	const log = await readLogEvents(root);
	if (log === undefined) {
		return undefined;
	}
	return log.events.find((event) => event.id === target);
}

// SPEC §4.18.2 + EC-5: re-run the inputs an event records; a pack version
// that is no longer installed fails as CDX-E011 naming the version needed.
export async function handleReplay(
	req: CommandRequest,
): Promise<Result<number>> {
	let id: string | undefined;
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length !== 1) {
			return usageError("usage: codictator replay <eventId>");
		}
		id = parsed.positionals[0];
	} catch {
		return usageError("usage: codictator replay <eventId>");
	}
	const target = id ?? "";
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const event = await findReplayEvent(root, target);
	if (event === undefined) {
		const log = await readLogEvents(root);
		if (log === undefined) {
			return fail(
				"CDX-E903",
				"event log unreadable",
				"Fix permissions on .codictator/state/, then retry.",
				req.json,
			);
		}
		if (!req.json) {
			process.stderr.write(`${await explain(target)}\n`);
		}
		return fail(
			"CDX-E010",
			`unknown event id "${target}"`,
			"List recent events with codictator report, then retry.",
			req.json,
		);
	}
	const engineKey = "codictator";
	const recorded = event.packs[engineKey];
	if (recorded !== undefined && recorded !== ENGINE_VERSION) {
		return fail(
			"CDX-E011",
			`replay needs pack codictator@${recorded}, installed is ${ENGINE_VERSION}`,
			`Install codictator@${recorded}, then rerun codictator replay ${target}.`,
			req.json,
		);
	}
	const summary = replaySummary(event);
	if (req.json) {
		printJson({ event: target, text: summary });
	} else {
		printHuman(summary, req.quiet);
	}
	return ok(0);
}
