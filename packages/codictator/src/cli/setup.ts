// SPEC §4.19.6: one-shot adoption. Flags mirror init (§4.19.2); the run
// is the init path (or regen over an existing config) plus install, hooks
// and verify, ending at the extension handoff (§4.20.1). Every step
// delegates to the existing init, guardrail and verify handlers; no step
// logic is duplicated here.
import { ENGINE_VERSION } from "../features/config/index.ts";
import type { Result } from "../kernel/index.ts";
import { err, ok } from "../kernel/index.ts";
import {
	configureHooksPath,
	handleRegen,
	writeHookFiles,
} from "./guardrail.ts";
import { parseInitFlags } from "./init.ts";
import {
	defaultHarnesses,
	type InitFlags,
	initPreamble,
	runInitSequence,
} from "./init-plan.ts";
import { handleVerify } from "./inspect.ts";
import { setupGitignoreStep } from "./setup-gitignore.ts";
import {
	hasEffectivePacks,
	SETUP_EXTENSION_ID,
	SETUP_EXTENSION_INSTALL,
	setupHandoffLines,
} from "./setup-handoff.ts";
import { setupInstallHere, setupInstallLayout } from "./setup-install.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	MIN_NODE_MAJOR,
	nodeMajor,
	nodeTooOldMessage,
	printHuman,
	printJson,
	readStateText,
	usageError,
} from "./shared.ts";

export const SETUP_USAGE =
	"usage: codictator setup [--harness <id> ...] [--profile <app|library|cli|service>] [--pack <id> ...] [--tool <role>=<command>@<pin> ...] [--repair]";

export interface SetupStep {
	readonly step: string;
	readonly ok: boolean;
	readonly detail?: Record<string, unknown>;
}

// SPEC §4.19.6 step 1: the Node floor, the human gate and the repo root.
async function setupPreflight(
	req: CommandRequest,
): Promise<string | Result<number>> {
	const version = req.nodeVersion ?? process.version;
	if (nodeMajor(version) < MIN_NODE_MAJOR) {
		return fail(
			"CDX-E002",
			nodeTooOldMessage(version),
			"Install a newer Node, then retry the tool call.",
			req.json,
		);
	}
	return initPreamble(req);
}

// SPEC §4.19.6 step 2: the adoption path. An existing config without
// --repair re-renders from config; otherwise the init path runs.
async function setupRegenPath(
	req: CommandRequest,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const regen = await handleRegen({ ...req, args: [] });
	if (!regen.ok) {
		return regen;
	}
	steps.push({ step: "init", ok: true, detail: { mode: "regen" } });
	printHuman(
		"setup: guardrails regenerated from the existing config",
		req.quiet,
	);
	return ok(0);
}

async function setupInitPath(
	req: CommandRequest,
	root: string,
	flags: InitFlags,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const engineVersion = req.engineVersion ?? ENGINE_VERSION;
	const sequenced = await runInitSequence(
		root,
		req,
		flags,
		defaultHarnesses(flags),
		engineVersion,
	);
	if (!sequenced.ok) {
		return sequenced;
	}
	steps.push({
		step: "init",
		ok: true,
		detail: {
			mode: flags.repair ? "repair" : "fresh",
			files: sequenced.value.written.map((entry) => entry.path),
		},
	});
	printHuman("setup: guardrails written from the init path", req.quiet);
	return ok(0);
}

async function setupAdopt(
	req: CommandRequest,
	root: string,
	flags: InitFlags,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const existing = await readStateText(root, ".codictator/config.json");
	if (existing !== undefined && !flags.repair) {
		return setupRegenPath(req, steps);
	}
	return setupInitPath(req, root, flags, steps);
}

// SPEC §4.19.6 step 6: hooks via the install-hooks writers.
async function setupHooksStep(
	req: CommandRequest,
	root: string,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const written = await writeHookFiles(root);
	if (!written.ok) {
		return fail(
			"CDX-E903",
			written.error.message,
			written.error.remediation,
			req.json,
		);
	}
	await configureHooksPath(root, req);
	steps.push({ step: "hooks", ok: true });
	printHuman("setup: hooks installed", req.quiet);
	return ok(0);
}

// SPEC §4.19.6 step 7: the first evaluation over the adopted repo. A
// blocking verdict stops the run with verify's own mapping (exit 1).
async function setupVerifyStep(
	req: CommandRequest,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const verdict = await handleVerify({ ...req, args: [] });
	if (!verdict.ok || verdict.value !== 0) {
		return verdict;
	}
	steps.push({ step: "verify", ok: true });
	return ok(0);
}

// SPEC §4.19.6 step 8 + §4.20.1: the views connect once a config exists;
// the human installs the extension with the printed command.
function setupHandoff(
	req: CommandRequest,
	root: string,
	steps: Array<SetupStep>,
	emptyPacks: boolean,
): Result<number> {
	steps.push({
		step: "handoff",
		ok: true,
		detail: { extension: SETUP_EXTENSION_ID },
	});
	if (req.json) {
		printJson({
			setup: true,
			root,
			steps,
			extension: { id: SETUP_EXTENSION_ID, install: SETUP_EXTENSION_INSTALL },
		});
	} else {
		for (const line of setupHandoffLines(emptyPacks)) {
			printHuman(line, req.quiet);
		}
	}
	return ok(0);
}

// SPEC §4.19.6: the eight adoption steps in order; a step failure stops
// the run with that step's §8.2 mapping.
export async function handleSetup(
	req: CommandRequest,
): Promise<Result<number>> {
	const flags = parseInitFlags(req.args);
	if (flags === undefined) {
		return usageError(SETUP_USAGE);
	}
	const preflight = await setupPreflight(req);
	if (typeof preflight !== "string") {
		return preflight;
	}
	const root = preflight;
	const steps: Array<SetupStep> = [{ step: "preflight", ok: true }];
	const adopted = await setupAdopt(req, root, flags, steps);
	if (!adopted.ok) {
		return adopted;
	}
	const ignored = await setupGitignoreStep(req, root, steps);
	if (!ignored.ok) {
		return ignored;
	}
	const layout = await setupInstallLayout(req, root, steps);
	if (!layout.ok) {
		return err(layout.error);
	}
	const installed = await setupInstallHere(req, root, layout.value, steps);
	if (!installed.ok) {
		return installed;
	}
	const hooked = await setupHooksStep(req, root, steps);
	if (!hooked.ok) {
		return hooked;
	}
	const verified = await setupVerifyStep(req, steps);
	if (!verified.ok) {
		return verified;
	}
	const emptyPacks = !(await hasEffectivePacks(root, flags));
	return setupHandoff(req, root, steps, emptyPacks);
}
