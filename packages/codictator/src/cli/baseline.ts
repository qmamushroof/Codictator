// SPEC §4.3.5 + §4.19.2: show the ratchet baseline, or capture it from the
// current findings (human-only capture).
import { parseArgs } from "node:util";
import { captureBaseline } from "../features/remediation/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok, parseJson, stableStringify } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
	fail,
	needRoot,
	printHuman,
	printJson,
	readStateText,
	usageError,
	writeStateText,
} from "./shared.ts";

async function baselineShow(
	req: CommandRequest,
	root: string,
): Promise<Result<number>> {
	if (req.args.length !== 1) {
		return usageError("usage: codictator baseline show");
	}
	const text = await readStateText(root, ".codictator/baseline.json");
	if (text === undefined) {
		printHuman("no baseline captured", req.quiet);
		if (req.json) {
			printJson({ baseline: null });
		}
		return ok(0);
	}
	if (req.json) {
		const parsed = parseJson(text);
		printJson({ baseline: parsed.ok ? parsed.value : text });
	} else {
		printHuman(text.trimEnd(), req.quiet);
	}
	return ok(0);
}

async function baselineCapture(
	req: CommandRequest,
	root: string,
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
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: { rule: { type: "string" } },
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0 || (parsed.values.rule ?? "") === "") {
			return usageError("usage: codictator baseline capture --rule <id>");
		}
	} catch {
		return usageError("usage: codictator baseline capture --rule <id>");
	}
	const captured = await captureBaseline(root, []);
	if (!captured.ok) {
		return fail(
			"CDX-E903",
			captured.error.message,
			captured.error.remediation,
			req.json,
		);
	}
	const saved = await writeStateText(
		root,
		".codictator/baseline.json",
		`${stableStringify(captured.value)}\n`,
	);
	if (!saved.ok) {
		return fail(
			"CDX-E903",
			saved.error.message,
			saved.error.remediation,
			req.json,
		);
	}
	printHuman("baseline captured", req.quiet);
	return ok(0);
}

export async function handleBaseline(
	req: CommandRequest,
): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "show" && sub !== "capture") {
		return usageError("usage: codictator baseline <show|capture --rule <id>>");
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	return sub === "show" ? baselineShow(req, root) : baselineCapture(req, root);
}
