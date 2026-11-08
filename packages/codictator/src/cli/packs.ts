// SPEC §4.16 + §4.4 + §4.5.7 + §4.19.5: generate, pack, adapter and serve.
// Custom guardrails need the LLM draft pipeline; without config.llm the
// command fails as CDX-E851. Pack test runs the owning self-test; builtin
// packs need no acceptance. The stdio server loop lives in serve-server.ts;
// handleServe below is its command-table entry.

import { ENGINE_VERSION } from "../features/config/index.ts";
import {
	acceptPack,
	loadBuiltinPack,
	loadPack,
	selfTest,
} from "../features/packs/index.ts";
import {
	type FloorRuleLine,
	floorRulesFromManifests,
} from "../features/steering/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { refuseNonHuman } from "./human-gate.ts";
import { runServer } from "./index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	type CommandPorts,
	fail,
	loadRepoConfig,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";

export { handleAdapter } from "./pack-adapters.ts";

const BUILTIN_IDS = ["core", "typescript", "dotnet", "python"];

// SPEC §4.6.2 item 3: the managed block lists every tier:floor rule of the
// loaded packs. Callers (init, regen, context) build floorRules through
// this loader over the configured pack ids; an unloadable pack falls back
// to the default rule set instead of failing the command, and the live
// gates still enforce the full registry.
export async function loadFloorRules(
	root: string,
	packIds: ReadonlyArray<string>,
): Promise<Array<FloorRuleLine> | undefined> {
	const ids = ["core", ...packIds.filter((id) => id !== "core")];
	const custom = ids.filter((id) => !BUILTIN_IDS.includes(id));
	let ports: CommandPorts | undefined;
	if (custom.length > 0) {
		const made = await portsFor(root);
		if (!made.ok) {
			return undefined;
		}
		ports = made.value;
	}
	const manifests = [];
	for (const id of ids) {
		if (BUILTIN_IDS.includes(id)) {
			const loaded = await loadBuiltinPack(id);
			if (!loaded.ok) {
				return undefined;
			}
			manifests.push(loaded.value.manifest);
			continue;
		}
		if (ports === undefined) {
			return undefined;
		}
		const loaded = await loadPack(`.codictator/packs/${id}`, {
			ports,
			skipAcceptance: true,
		});
		if (!loaded.ok) {
			return undefined;
		}
		manifests.push(loaded.value.manifest);
	}
	return floorRulesFromManifests(manifests);
}

export async function handleGenerate(
	req: CommandRequest,
): Promise<Result<number>> {
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const configured = await loadRepoConfig(
		root,
		undefined,
		req.engineVersion ?? ENGINE_VERSION,
	);
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
	const gated = refuseNonHuman(req);
	if (gated !== undefined) {
		return gated;
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

// SPEC §4.19.5: the stdio server for the extension. The command takes
// exactly --stdio; the loop serves one NDJSON session on this process's
// stdio and exits 0 when the client disconnects.
export async function handleServe(
	req: CommandRequest,
): Promise<Result<number>> {
	if (req.args[0] !== "--stdio" || req.args.length !== 1) {
		return usageError("usage: codictator serve --stdio");
	}
	const code = await runServer({
		argv: ["serve", ...req.args],
		cwd: req.cwd,
		...(req.engineVersion === undefined
			? {}
			: { engineVersion: req.engineVersion }),
	});
	return ok(code);
}
