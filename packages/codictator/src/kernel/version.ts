// SPEC §4.2.1: the installed engine version. Config's `codictator` field
// must equal this (§7.2, EC-11); the CLI resolves it once at startup and
// threads it through, so only the kernel touches the filesystem (§3.3).
import { fileURLToPath } from "node:url";
import { makeError } from "./errors.ts";
import { readHostText } from "./host.ts";
import { parseJson } from "./json.ts";
import { err, ok, type Result } from "./result.ts";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The version field of a decoded engine manifest, validated apart from
// the manifest read below.
function manifestVersion(raw: unknown): Result<string> {
	if (!isObject(raw)) {
		return err(
			makeError(
				"CDX-E903",
				"the engine manifest is not an object",
				"Reinstall codictator, then retry.",
			),
		);
	}
	const key = "version";
	const version = raw[key];
	if (typeof version !== "string" || version === "") {
		return err(
			makeError(
				"CDX-E903",
				"the engine manifest has no version",
				"Reinstall codictator, then retry.",
			),
		);
	}
	return ok(version);
}

// src/kernel/version.ts and dist/kernel/version.js both sit two levels
// below the engine root, so ../../package.json names the engine manifest
// in either layout. A missing or malformed manifest fails, and the caller
// falls back to the pinned placeholder; tests pin the placeholder.
export async function installedEngineVersion(): Promise<Result<string>> {
	let manifestPath: string;
	try {
		manifestPath = fileURLToPath(
			new URL("../../package.json", import.meta.url),
		);
	} catch {
		return err(
			makeError(
				"CDX-E903",
				"cannot locate the engine manifest",
				"Reinstall codictator, then retry.",
			),
		);
	}
	const text = await readHostText(manifestPath);
	if (!text.ok) {
		return err(text.error);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	return manifestVersion(parsed.value);
}
