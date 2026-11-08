// SPEC §4.15.1 + §4.15.5/§4.15.6: setup detection for the generated
// workflow. Split from plan.ts by responsibility (core/file-size): plan
// keeps the guardrail plan assembly, the workflow options detection lives
// here.
import type { RenderWorkflowOptions } from "../features/ci/index.ts";
import { parseJson } from "../kernel/index.ts";
import { readStateText } from "./shared.ts";

function isRecordValue(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// SPEC §4.15.1 + §4.15.5/§4.15.6: setup detection for the generated
// workflow. The self-host decision reads the root manifest's explicit
// `codictator.selfHost` flag, never path guessing; the install command
// reads lockfile presence (`npm ci` only with a lockfile), the build step
// reads the build script, and the Node version file reads `.nvmrc`.
export async function detectWorkflowOptions(
	root: string,
): Promise<RenderWorkflowOptions> {
	const manifest = await readStateText(root, "package.json");
	let selfHost = false;
	let buildCommand: string | undefined;
	if (manifest !== undefined) {
		const parsed = parseJson(manifest);
		if (parsed.ok && isRecordValue(parsed.value)) {
			// Index-signature reads ride const keys (TS4111 forbids the
			// dot form, the literal-keys rule the string form).
			const codictatorKey = "codictator";
			const selfHostKey = "selfHost";
			const scriptsKey = "scripts";
			const buildKey = "build";
			const flag = parsed.value[codictatorKey];
			selfHost = isRecordValue(flag) && flag[selfHostKey] === true;
			const scripts = parsed.value[scriptsKey];
			if (
				isRecordValue(scripts) &&
				typeof scripts[buildKey] === "string"
			) {
				buildCommand = "npm run build";
			}
		}
	}
	if (selfHost) {
		return { selfHost };
	}
	const lockfile = await readStateText(root, "package-lock.json");
	const versionFile = await readStateText(root, ".nvmrc");
	return {
		...(lockfile === undefined
			? { installCommand: "npm install --ignore-scripts" }
			: {}),
		...(buildCommand === undefined ? {} : { buildCommand }),
		...(versionFile === undefined ? {} : { nodeVersionFile: ".nvmrc" }),
	};
}
