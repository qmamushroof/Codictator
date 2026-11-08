// SPEC §4.18.5 + §4.19.2: report and context. Report computes PRD §10
// metrics from local sources only; context prints the current scoped
// injection (§4.6.3), with --all adding config hash and harness list.
import { parseArgs } from "node:util";
import { buildReportText } from "../features/audit/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import {
	buildManagedBlock,
	type FloorRuleLine,
	PRECEDENCE_STATEMENT,
} from "../features/steering/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { readLogEvents } from "./inspect.ts";
import { loadFloorRules } from "./packs.ts";
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

// SPEC §4.18.5: PRD §10 metrics from local sources only.
export async function handleReport(
	req: CommandRequest,
): Promise<Result<number>> {
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator report");
		}
	} catch {
		return usageError("usage: codictator report");
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
	const log = await readLogEvents(root);
	if (log === undefined) {
		return fail(
			"CDX-E903",
			"event log unreadable",
			"Fix permissions on .codictator/state/, then retry.",
			req.json,
		);
	}
	const text = buildReportText({
		events: log.events,
		corrupt: log.corrupt,
		now: ports.value.clock.now(),
	});
	if (req.json) {
		printJson({
			now: ports.value.clock.now(),
			events: log.events.length,
			corrupt: log.corrupt,
			text,
		});
	} else {
		printHuman(text, req.quiet);
	}
	return ok(0);
}

// SPEC §4.19.2: the current scoped injection (§4.6.3); --all adds config
// hash and harness list.
export async function handleContext(
	req: CommandRequest,
): Promise<Result<number>> {
	let all = false;
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: { all: { type: "boolean", default: false } },
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator context [--all]");
		}
		all = parsed.values.all ?? false;
	} catch {
		return usageError("usage: codictator context [--all]");
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	let extra = "";
	let floorRules: Array<FloorRuleLine> | undefined;
	const configured = await loadRepoConfig(
		root,
		undefined,
		req.engineVersion ?? ENGINE_VERSION,
	);
	if (configured.ok) {
		floorRules = await loadFloorRules(
			root,
			configured.value.effective.config.packs.map((entry) => entry.id),
		);
		if (all) {
			extra = `\nconfig ${configured.value.effective.configHash} harnesses ${configured.value.effective.config.harnesses.join(",")}`;
		}
	} else if (all) {
		extra = "\nconfig unknown (unreadable)";
	}
	const text = `${PRECEDENCE_STATEMENT}\n\n${floorRules === undefined ? buildManagedBlock() : buildManagedBlock({ floorRules })}${extra}`;
	if (req.json) {
		printJson({ context: text });
	} else {
		printHuman(text, req.quiet);
	}
	return ok(0);
}
