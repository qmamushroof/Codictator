// SPEC §4.14.4 + §4.14.5 + §4.19.2: regen, install-hooks and uninstall.
// Regen re-renders guardrails from config and rewrites the manifest;
// install-hooks writes the hooks and points core.hooksPath at them;
// uninstall removes generated files with the CI warning.
import { parseArgs } from "node:util";
import {
	renderCustomRegenFragment,
	withCodictatorOwner,
} from "../features/adapters/index.ts";
import { ENGINE_VERSION } from "../features/config/index.ts";
import {
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
	hookInstallPlan,
	renderHookScript,
} from "../features/integrity/index.ts";
import type { Result } from "../kernel/index.ts";
import { err, ok, resolveRepoRoot } from "../kernel/index.ts";
import { initPreamble, detectWorkflowOptions } from "./init-plan.ts";
import { loadFloorRules } from "./packs.ts";
import { guardrailPlan, writePlan } from "./plan.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	loadRepoConfig,
	portsFor,
	printHuman,
	printJson,
	readStateText,
	usageError,
} from "./shared.ts";

function repoNameOf(root: string): string {
	return root.replaceAll("\\", "/").split("/").pop() ?? "repo";
}

// SPEC §4.14.5: regen re-renders from config, so a profile chosen at init
// survives regeneration instead of being dropped from the rewritten config.
function profileOf(architecture: unknown): string {
	if (typeof architecture === "object" && architecture !== null) {
		const profile = (architecture as { readonly profile?: unknown }).profile;
		if (typeof profile === "string" && profile !== "") {
			return profile;
		}
	}
	return "";
}

// SPEC §4.14.5: regen re-renders guardrails from config and rewrites the
// manifest; user text outside managed regions survives.
// Regen, install-hooks and uninstall reject positionals the same way.
function rejectPositionals(
	args: ReadonlyArray<string>,
	usage: string,
): Result<number> | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError(usage);
		}
	} catch {
		return usageError(usage);
	}
	return undefined;
}

export async function handleRegen(
	req: CommandRequest,
): Promise<Result<number>> {
	const rejected = rejectPositionals(req.args, "usage: codictator regen");
	if (rejected !== undefined) {
		return rejected;
	}
	const root = await resolveRepoRoot(req.cwd);
	if (!root.ok) {
		return fail(
			"CDX-E703",
			root.error.message,
			root.error.remediation,
			req.json,
		);
	}
	const loaded = await loadRepoConfig(
		root.value,
		undefined,
		req.engineVersion ?? ENGINE_VERSION,
	);
	if (!loaded.ok) {
		return fail(
			loaded.error.code,
			loaded.error.message,
			"Fix .codictator/config.json, then retry.",
			req.json,
		);
	}
	const agents = await readStateText(root.value, "AGENTS.md");
	const configured = loaded.value.effective.config;
	const profile = profileOf(configured.architecture);
	const customFiles = await renderCustomRegenFragment(root.value, configured);
	if (!customFiles.ok) {
		return fail(
			customFiles.error.code,
			customFiles.error.message,
			customFiles.error.remediation,
			req.json,
		);
	}
	const floorRules = await loadFloorRules(
		root.value,
		configured.packs.map((entry) => entry.id),
	);
	const plan = guardrailPlan(
		loaded.value.effective.config.harnesses,
		profile,
		repoNameOf(root.value),
		agents,
		{
			packs: configured.packs,
			tunables: configured.tunables,
			architecture: configured.architecture,
			tools: configured.tools,
			...(floorRules === undefined ? {} : { floorRules }),
		},
		req.engineVersion ?? ENGINE_VERSION,
		root.value,
		await detectWorkflowOptions(root.value),
	);
	// SPEC §4.14.1: custom fragments keep the historical codictator owner.
	const customOwned = withCodictatorOwner(customFiles.value);
	const wrote = await writePlan(
		root.value,
		{
			files: [...plan.files, ...customOwned],
		},
		req.engineVersion ?? ENGINE_VERSION,
	);
	if (!wrote.ok) {
		return fail(
			"CDX-E903",
			wrote.error.message,
			wrote.error.remediation,
			req.json,
		);
	}
	if (req.json) {
		printJson({
			regenerated: true,
			root: root.value,
			files: wrote.value.map((entry) => entry.path),
		});
	} else {
		for (const entry of wrote.value) {
			printHuman(`regenerated ${entry.path}`, req.quiet);
		}
	}
	return ok(0);
}

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

export async function writeHookFiles(root: string): Promise<Result<true>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	for (const hook of HOOK_NAMES) {
		const done = await ports.value.fs.write(
			`${EXPECTED_HOOKS_PATH}/${hook}`,
			encode(renderHookScript(hook)),
		);
		if (!done.ok) {
			return err(done.error);
		}
	}
	const plan = hookInstallPlan({});
	const attrs = await ports.value.fs.write(
		`${EXPECTED_HOOKS_PATH}/.gitattributes`,
		encode(plan.gitattributes),
	);
	if (!attrs.ok) {
		return err(attrs.error);
	}
	return ok(true);
}

export async function configureHooksPath(
	root: string,
	req: CommandRequest,
): Promise<void> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return;
	}
	const plan = hookInstallPlan({});
	const set = await ports.value.proc.run(
		["git", "config", "core.hooksPath", plan.hooksPath],
		{ cwd: root, env: {}, timeoutMs: 15000, maxOutputBytes: 65536 },
	);
	if (set.code !== 0) {
		printHuman(
			"warn: git config core.hooksPath failed; set it by hand",
			req.quiet,
		);
	}
}

// SPEC §4.14.4: install-hooks writes the hooks and points core.hooksPath
// at them; the npm prepare script and gitattributes remediation ship too.
export async function handleInstallHooks(
	req: CommandRequest,
): Promise<Result<number>> {
	const rejected = rejectPositionals(
		req.args,
		"usage: codictator install-hooks",
	);
	if (rejected !== undefined) {
		return rejected;
	}
	const root = await resolveRepoRoot(req.cwd);
	if (!root.ok) {
		return fail(
			"CDX-E703",
			root.error.message,
			root.error.remediation,
			req.json,
		);
	}
	const written = await writeHookFiles(root.value);
	if (!written.ok) {
		return fail(
			"CDX-E903",
			written.error.message,
			written.error.remediation,
			req.json,
		);
	}
	await configureHooksPath(root.value, req);
	const plan = hookInstallPlan({});
	if (req.json) {
		printJson({ installed: true, hooksPath: plan.hooksPath, root: root.value });
	} else {
		printHuman(
			`hooks installed at ${plan.hooksPath}; prepare script: ${plan.prepareScript}`,
			req.quiet,
		);
	}
	return ok(0);
}

async function removeGuardrails(root: string): Promise<void> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return;
	}
	const targets = [
		".codictator/config.json",
		".codictator/manifest.json",
		".github/workflows/codictator.yml",
		...HOOK_NAMES.map((hook) => `${EXPECTED_HOOKS_PATH}/${hook}`),
	];
	for (const target of targets) {
		const seen = await ports.value.fs.exists(target);
		if (seen.ok && seen.value) {
			await ports.value.fs.remove(target);
		}
	}
}

// SPEC §4.19.2: uninstall removes generated files, records a guardrail
// entry, and prints that CI fails until its workflow and required check
// are removed too. Human-only.
export async function handleUninstall(
	req: CommandRequest,
): Promise<Result<number>> {
	const rejected = rejectPositionals(req.args, "usage: codictator uninstall");
	if (rejected !== undefined) {
		return rejected;
	}
	const preamble = await initPreamble(req);
	if (typeof preamble !== "string") {
		return preamble;
	}
	const root = preamble;
	await removeGuardrails(root);
	const note =
		"CI will fail until its workflow and required check are removed too.";
	if (req.json) {
		printJson({ uninstalled: true, root, note });
	} else {
		printHuman(`uninstalled guardrails from ${root}`, req.quiet);
		printHuman(note, req.quiet);
	}
	return ok(0);
}
