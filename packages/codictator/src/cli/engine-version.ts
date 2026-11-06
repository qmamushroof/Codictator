// SPEC §4.19 EC-6: arbitration between the root and tool-dir engines. The
// launcher boots the first candidate that exists (plan-launcher.ts); the CLI
// then arbitrates before config load: both installs at different versions is
// CDX-E102, and the root install wins only when it equals
// config.codictator. A single install (or none) keeps the previous behavior,
// so repos without engine manifests resolve the threaded fallback untouched.
import type { Fs, Result } from "../kernel/index.ts";
import { err, makeError, ok, parseJson } from "../kernel/index.ts";

const ROOT_MANIFEST_REL = "node_modules/codictator/package.json";
const TOOL_MANIFEST_REL =
	".codictator/tool/node_modules/codictator/package.json";
const CONFIG_REL = ".codictator/config.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A manifest version is the decoded `version` string; anything missing or
// malformed reads as absent, so a half-written install degrades to the
// fallback instead of failing the command.
function manifestVersionOf(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const key = "version";
	const version = value[key];
	return typeof version === "string" && version !== "" ? version : undefined;
}

async function installedVersion(
	fs: Fs,
	rel: string,
): Promise<string | undefined> {
	const seen = await fs.exists(rel);
	if (!seen.ok || !seen.value) {
		return undefined;
	}
	const text = await fs.readText(rel);
	if (!text.ok) {
		return undefined;
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return undefined;
	}
	return manifestVersionOf(parsed.value);
}

// The raw config.codictator field, read without validation: arbitration runs
// before config load, so a missing or invalid config reads as unknown and a
// divergence still fails closed with CDX-E102 below.
async function configuredVersion(fs: Fs): Promise<string | undefined> {
	const seen = await fs.exists(CONFIG_REL);
	if (!seen.ok || !seen.value) {
		return undefined;
	}
	const text = await fs.readText(CONFIG_REL);
	if (!text.ok) {
		return undefined;
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok || !isRecord(parsed.value)) {
		return undefined;
	}
	const key = "codictator";
	const codictator = parsed.value[key];
	return typeof codictator === "string" && codictator !== ""
		? codictator
		: undefined;
}

// SPEC §4.19 EC-6: resolve which installed engine the command validates
// against. Equal installs (or a single one) answer directly; differing
// installs need config.codictator to name the root one, else CDX-E102.
export async function resolveEngineVersion(
	fs: Fs,
	fallback: string,
): Promise<Result<string>> {
	const root = await installedVersion(fs, ROOT_MANIFEST_REL);
	const tool = await installedVersion(fs, TOOL_MANIFEST_REL);
	if (root === undefined || tool === undefined || root === tool) {
		return ok(root ?? tool ?? fallback);
	}
	const configured = await configuredVersion(fs);
	if (configured !== undefined && configured === root) {
		return ok(root);
	}
	return err(
		makeError(
			"CDX-E102",
			`root engine "${root}" differs from tool-dir engine "${tool}"`,
			`Align both installs on one version and set "codictator" to it in .codictator/config.json.`,
		),
	);
}
