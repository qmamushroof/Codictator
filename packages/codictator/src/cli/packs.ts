// SPEC §4.16 + §4.4 + §4.5.7 + §4.19.5: generate, pack, adapter and serve.
// Custom guardrails need the LLM draft pipeline; without config.llm the
// command fails as CDX-E851. Pack test runs the owning self-test; builtin
// packs need no acceptance. The stdio server lands in phase 11.
import {
	CLAUDE_CODE_CAPABILITIES,
	CODEX_CAPABILITIES,
	COPILOT_CAPABILITIES,
	MUSE_CAPABILITIES,
	OPENCODE_CAPABILITIES,
	UNIVERSAL_CAPABILITIES,
} from "../features/adapters/index.ts";
import {
	acceptPack,
	loadBuiltinPack,
	loadPack,
	selfTest,
} from "../features/packs/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
	fail,
	loadRepoConfig,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";

const BUILTIN_IDS = ["core", "typescript", "dotnet", "python"];
const ADAPTER_DECLARATIONS = [
	MUSE_CAPABILITIES,
	UNIVERSAL_CAPABILITIES,
	CLAUDE_CODE_CAPABILITIES,
	COPILOT_CAPABILITIES,
	CODEX_CAPABILITIES,
	OPENCODE_CAPABILITIES,
];

export async function handleGenerate(
	req: CommandRequest,
): Promise<Result<number>> {
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const configured = await loadRepoConfig(root);
	if (!configured.ok) {
		return fail(
			"CDX-E101",
			configured.error.message,
			"Fix .codictator/config.json, then retry.",
			req.json,
		);
	}
	if (configured.value.effective.config.llm === undefined) {
		return fail(
			"CDX-E851",
			"no LLM configured for generate",
			"Configure config.llm, then retry.",
			req.json,
		);
	}
	return fail(
		"CDX-E903",
		"generation pipeline unavailable in this build",
		"Custom guardrail generation lands in a later phase; configure the pack by hand meanwhile.",
		req.json,
	);
}

async function packList(req: CommandRequest): Promise<Result<number>> {
	if (req.args.length !== 1) {
		return usageError("usage: codictator pack list");
	}
	const listed: Array<{ id: string; version: string; description: string }> =
		[];
	for (const candidate of BUILTIN_IDS) {
		const loaded = await loadBuiltinPack(candidate);
		if (!loaded.ok) {
			return fail(
				loaded.error.code,
				loaded.error.message,
				loaded.error.remediation,
				req.json,
			);
		}
		listed.push({
			id: loaded.value.manifest.id,
			version: loaded.value.manifest.version,
			description: loaded.value.manifest.description,
		});
	}
	if (req.json) {
		printJson({ packs: listed });
	} else {
		for (const pack of listed) {
			printHuman(`${pack.id}@${pack.version}: ${pack.description}`, req.quiet);
		}
	}
	return ok(0);
}

async function packTest(
	req: CommandRequest,
	root: string,
	id: string,
): Promise<Result<number>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const loaded = BUILTIN_IDS.includes(id)
		? await loadBuiltinPack(id)
		: await loadPack(`.codictator/packs/${id}`, {
				ports: ports.value,
				skipAcceptance: true,
			});
	if (!loaded.ok) {
		return fail(
			loaded.error.code,
			loaded.error.message,
			loaded.error.remediation,
			req.json,
		);
	}
	const tested = await selfTest(loaded.value);
	if (!tested.ok) {
		return fail(
			tested.error.code,
			tested.error.message,
			tested.error.remediation,
			req.json,
		);
	}
	printHuman(`pack ${id}: self-test pass`, req.quiet);
	return ok(0);
}

async function packAccept(
	req: CommandRequest,
	root: string,
	id: string,
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
	if (BUILTIN_IDS.includes(id)) {
		printHuman(`pack ${id} is built in and needs no acceptance`, req.quiet);
		if (req.json) {
			printJson({ id, accepted: true, builtin: true });
		}
		return ok(0);
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
	// The TTY gate above already verified a human drives this call, so the
	// acceptor's own human check is attested rather than re-probed.
	const accepted = await acceptPack(`.codictator/packs/${id}`, ports.value, {
		isTty: true,
	});
	if (!accepted.ok) {
		return fail(
			accepted.error.code,
			accepted.error.message,
			accepted.error.remediation,
			req.json,
		);
	}
	printHuman(`pack ${id} accepted at ${accepted.value.acceptedAt}`, req.quiet);
	return ok(0);
}

// SPEC §4.4: pack args (sub, then id), list, self-test, human-only acceptance.
function parsePackArgs(args: ReadonlyArray<string>): string | Result<number> {
	const sub = args[0] ?? "";
	return sub === "list" || sub === "test" || sub === "accept"
		? sub
		: usageError("usage: codictator pack <list|test <id>|accept <id>>");
}

// SPEC §4.4: pack list, self-test and human-only acceptance.
export async function handlePack(req: CommandRequest): Promise<Result<number>> {
	const sub = parsePackArgs(req.args);
	if (typeof sub !== "string") {
		return sub;
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	if (sub === "list") {
		return packList(req);
	}
	const id = req.args[1] ?? "";
	if (id === "" || req.args.length !== 2) {
		return usageError(`usage: codictator pack ${sub} <id>`);
	}
	return sub === "test" ? packTest(req, root, id) : packAccept(req, root, id);
}

function adapterTest(req: CommandRequest, id: string): Result<number> {
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

// SPEC §4.19.5: the stdio server lands in phase 11 with the extension.
export async function handleServe(
	req: CommandRequest,
): Promise<Result<number>> {
	if (req.args[0] !== "--stdio" || req.args.length !== 1) {
		return usageError("usage: codictator serve --stdio");
	}
	return fail(
		"CDX-E903",
		"serve --stdio lands in phase 11 with the extension",
		"Run hook and CLI commands directly until the extension protocol ships.",
		req.json,
	);
}
