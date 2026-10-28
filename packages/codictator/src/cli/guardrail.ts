// SPEC §4.14.4 + §4.14.5 + §4.19.2: regen, install-hooks and uninstall.
// Regen re-renders guardrails from config and rewrites the manifest;
// install-hooks writes the hooks and points core.hooksPath at them;
// uninstall removes generated files with the CI warning.
import { parseArgs } from "node:util";
import {
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
	hookInstallPlan,
	renderHookScript,
} from "../features/integrity/index.ts";
import type { Result } from "../kernel/index.ts";
import { err, ok, resolveRepoRoot } from "../kernel/index.ts";
import { guardrailPlan, writePlan } from "./plan.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
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

function emitRegen(
	req: CommandRequest,
	root: string,
	files: ReadonlyArray<{ path: string }>,
): Result<number> {
	if (req.json) {
		printJson({
			regenerated: true,
			root,
			files: files.map((entry) => entry.path),
		});
	} else {
		for (const entry of files) {
			printHuman(`regenerated ${entry.path}`, req.quiet);
		}
	}
	return ok(0);
}

// SPEC §4.14.5: regen re-renders guardrails from config and rewrites the
// manifest; user text outside managed regions survives.
export async function handleRegen(
	req: CommandRequest,
): Promise<Result<number>> {
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator regen");
		}
	} catch {
		return usageError("usage: codictator regen");
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
	const loaded = await loadRepoConfig(root.value);
	if (!loaded.ok) {
		return fail(
			loaded.error.code,
			loaded.error.message,
			"Fix .codictator/config.json, then retry.",
			req.json,
		);
	}
	const agents = await readStateText(root.value, "AGENTS.md");
	const wrote = await writePlan(
		root.value,
		guardrailPlan(
			loaded.value.effective.config.harnesses,
			"",
			repoNameOf(root.value),
			agents,
		),
	);
	if (!wrote.ok) {
		return fail(
			"CDX-E903",
			wrote.error.message,
			wrote.error.remediation,
			req.json,
		);
	}
	return emitRegen(req, root.value, wrote.value);
}

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

async function writeHookFiles(root: string): Promise<Result<true>> {
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

async function configureHooksPath(
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
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator install-hooks");
		}
	} catch {
		return usageError("usage: codictator install-hooks");
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
	try {
		const parsed = parseArgs({
			args: [...req.args],
			options: {},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator uninstall");
		}
	} catch {
		return usageError("usage: codictator uninstall");
	}
	const human = checkHuman(commandEnv(), []);
	if (!human.ok) {
		return fail(
			"CDX-E107",
			human.error.message,
			human.error.remediation,
			req.json,
		);
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
	await removeGuardrails(root.value);
	const note =
		"CI will fail until its workflow and required check are removed too.";
	if (req.json) {
		printJson({ uninstalled: true, root: root.value, note });
	} else {
		printHuman(`uninstalled guardrails from ${root.value}`, req.quiet);
		printHuman(note, req.quiet);
	}
	return ok(0);
}
