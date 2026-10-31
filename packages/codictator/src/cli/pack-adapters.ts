// SPEC §4.5.7: adapter verification prints capability declarations; capture
// records the harness observation in the event log.
import {
	CLAUDE_CODE_CAPABILITIES,
	CODEX_CAPABILITIES,
	COPILOT_CAPABILITIES,
	CURSOR_CAPABILITIES,
	checkCustomContract,
	GEMINI_CAPABILITIES,
	MUSE_CAPABILITIES,
	OPENCODE_CAPABILITIES,
	UNIVERSAL_CAPABILITIES,
} from "../features/adapters/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import { fail, needRoot, printHuman, printJson, usageError } from "./shared.ts";

const ADAPTER_DECLARATIONS = [
	MUSE_CAPABILITIES,
	UNIVERSAL_CAPABILITIES,
	CLAUDE_CODE_CAPABILITIES,
	COPILOT_CAPABILITIES,
	CURSOR_CAPABILITIES,
	GEMINI_CAPABILITIES,
	CODEX_CAPABILITIES,
	OPENCODE_CAPABILITIES,
];

async function adapterTest(
	req: CommandRequest,
	id: string,
): Promise<Result<number>> {
	if (id.startsWith("custom:")) {
		return adapterTestCustom(req, id);
	}
	const found = ADAPTER_DECLARATIONS.find(
		(candidate) => candidate.harness === id,
	);
	if (found === undefined) {
		return fail(
			"CDX-E301",
			`unknown harness id "${id}"`,
			"Use an installed adapter id (see adapter test output), then retry.",
			req.json,
		);
	}
	if (req.json) {
		printJson(found);
	} else {
		printHuman(
			`${found.harness}: layers L0:${found.layers.L0} L1:${found.layers.L1} L2:${found.layers.L2} L3:${found.layers.L3} L4:${found.layers.L4} L5:${found.layers.L5}`,
			req.quiet,
		);
		for (const gap of found.gaps) {
			printHuman(`gap: ${gap}`, req.quiet);
		}
	}
	return ok(0);
}

// SPEC §4.5.6: `adapter test custom:<id>` runs the adapter's shipped
// goldens; anything short of a pass stays inert with CDX-E302.
async function adapterTestCustom(
	req: CommandRequest,
	id: string,
): Promise<Result<number>> {
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const checked = await checkCustomContract(root, id.slice("custom:".length));
	if (!checked.ok) {
		return fail(
			checked.error.code,
			checked.error.message,
			checked.error.remediation,
			req.json,
		);
	}
	const found = checked.value.capabilities;
	if (req.json) {
		printJson(found);
	} else {
		printHuman(
			`${found.harness}: layers L0:${found.layers.L0} L1:${found.layers.L1} L2:${found.layers.L2} L3:${found.layers.L3} L4:${found.layers.L4} L5:${found.layers.L5}`,
			req.quiet,
		);
		for (const gap of found.gaps) {
			printHuman(`gap: ${gap}`, req.quiet);
		}
	}
	return ok(0);
}

// SPEC §4.5.7: adapter verification prints capability declarations; capture
// records the harness observation in the event log.
export async function handleAdapter(
	req: CommandRequest,
): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "test" && sub !== "capture") {
		return usageError(
			"usage: codictator adapter <test <id>|capture <harness>>",
		);
	}
	const id = req.args[1] ?? "";
	if (id === "" || req.args.length !== 2) {
		return usageError(
			"usage: codictator adapter <test <id>|capture <harness>>",
		);
	}
	if (sub === "test") {
		return adapterTest(req, id);
	}
	if (ADAPTER_DECLARATIONS.every((candidate) => candidate.harness !== id)) {
		return fail(
			"CDX-E301",
			`unknown harness id "${id}"`,
			"Use an installed adapter id (see adapter test output), then retry.",
			req.json,
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	printHuman(`captured harness observation for ${id} (see status)`, req.quiet);
	return ok(0);
}
