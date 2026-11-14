// SPEC §4.14.4 + §9.2: write the git hooks. Split from guardrail.ts by
// responsibility (core/file-size).
import {
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
	hookInstallPlan,
	renderHookScript,
} from "../features/integrity/index.ts";
import type { Fs, Result } from "../kernel/index.ts";
import { err, ok } from "../kernel/index.ts";
import { portsFor } from "./shared.ts";

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

// The hooks carry the plan's mode (755), because git silently skips a
// non-executable hook under core.hooksPath (BUG-0093); the attributes file
// is a plain generated file.
export async function writeHooksWith(files: Fs): Promise<Result<true>> {
	const plan = hookInstallPlan({});
	for (const hook of HOOK_NAMES) {
		const done = await files.write(
			`${EXPECTED_HOOKS_PATH}/${hook}`,
			encode(renderHookScript(hook)),
			plan.mode,
		);
		if (!done.ok) {
			return err(done.error);
		}
	}
	const attrs = await files.write(
		`${EXPECTED_HOOKS_PATH}/.gitattributes`,
		encode(plan.gitattributes),
	);
	if (!attrs.ok) {
		return err(attrs.error);
	}
	return ok(true);
}

export async function writeHookFiles(root: string): Promise<Result<true>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	return writeHooksWith(ports.value.fs);
}
