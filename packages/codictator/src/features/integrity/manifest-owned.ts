// SPEC §4.14.1 manifest-owned: the paths the guardrail manifest lists.
// Deterministic: sorted, unique. A missing, unparseable or tampered
// manifest lists nothing, so only the fixed manifest-owned set applies and
// the change class stays the stricter one (§10.3 fail closed).
import type { Ports } from "../../kernel/index.ts";
import { parseJson } from "../../kernel/index.ts";
import type { GuardrailManifest } from "./manifest.ts";
import { verifyManifest } from "./manifest.ts";

const MANIFEST = ".codictator/manifest.json";

export function manifestPathsOf(text: string): ReadonlyArray<string> {
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return [];
	}
	const manifest = parsed.value as GuardrailManifest;
	if (!Array.isArray(manifest.artifacts) || !verifyManifest(manifest)) {
		return [];
	}
	const paths = manifest.artifacts
		.map((artifact) => artifact.path)
		.filter((path) => typeof path === "string");
	return [...new Set(paths)].sort();
}

export async function readManifestPaths(
	ports: Ports,
): Promise<ReadonlyArray<string>> {
	const seen = await ports.fs.exists(MANIFEST);
	if (!seen.ok || !seen.value) {
		return [];
	}
	const text = await ports.fs.readText(MANIFEST);
	return text.ok ? manifestPathsOf(text.value) : [];
}
