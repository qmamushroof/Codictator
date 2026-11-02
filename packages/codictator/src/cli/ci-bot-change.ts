// SPEC §4.15: bot-change recording for ci record-bot-change. Split from
// ci.ts by responsibility (core/file-size): this module owns the
// record-bot-change flags and verdict, ci.ts owns the dispatch.
import { parseArgs } from "node:util";
import { qualifyBotChange } from "../features/ci/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import { printHuman, printJson, usageError } from "./shared.ts";

interface BotChangeFlags {
	readonly author: string;
	readonly files: ReadonlyArray<string>;
	readonly fork: boolean;
}

function parseRecordFlags(req: CommandRequest): BotChangeFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: {
				author: { type: "string" },
				files: { type: "string", multiple: true, default: [] },
				fork: { type: "boolean", default: false },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if (
			(parsed.values.author ?? "") === "" ||
			(parsed.values.files ?? []).length === 0
		) {
			return undefined;
		}
		return {
			author: parsed.values.author ?? "",
			files: [...(parsed.values.files ?? [])],
			fork: parsed.values.fork ?? false,
		};
	} catch {
		return undefined;
	}
}

export function ciRecordBotChange(req: CommandRequest): Result<number> {
	const flags = parseRecordFlags(req);
	if (flags === undefined) {
		return usageError(
			"usage: codictator ci record-bot-change --author <bot> --files <f> ... [--fork]",
		);
	}
	const planned = qualifyBotChange({
		author: flags.author,
		filesChanged: flags.files,
		isFork: flags.fork,
		trailerExempt: [],
	});
	if (req.json) {
		printJson(planned);
	} else {
		printHuman(
			`bot change qualifies: ${planned.qualifies}, write commit: ${planned.writeCommit}`,
			req.quiet,
		);
	}
	return planned.findings.length === 0 ? ok(0) : ok(1);
}
