// SPEC §4.14.1 + §7.14: the guardrail lockfile. Generation is deterministic
// (artifacts sorted by path, stableStringify, no timestamps), so regen on
// unchanged config reproduces the manifest byte for byte (§4.14 EC-11).
import { sha256Text, stableStringify } from "../../kernel/index.ts";

export interface ManifestArtifact {
	readonly path: string;
	readonly owner: string;
	readonly mode: "file" | "block" | "entries";
	readonly hash: string;
}

export interface GuardrailManifest {
	readonly version: 1;
	readonly codictator: string;
	readonly artifacts: ReadonlyArray<ManifestArtifact>;
	readonly hash: string;
}

// SPEC §7.14: the manifest hash covers the sorted artifacts array, so any
// edit of the manifest itself outside regen is detectable (§4.14.2).
export function manifestHash(
	artifacts: ReadonlyArray<ManifestArtifact>,
): string {
	const sorted = [...artifacts].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	return sha256Text(stableStringify(sorted));
}

// SPEC §4.14.5: regen rebuilds the manifest from config; sorting here keeps
// the output independent of enumeration order and OS (EC-11).
export function buildManifest(
	codictator: string,
	artifacts: ReadonlyArray<ManifestArtifact>,
): GuardrailManifest {
	const sorted = [...artifacts].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	return {
		version: 1,
		codictator,
		artifacts: sorted,
		hash: manifestHash(artifacts),
	};
}

// SPEC §4.14.2: recompute the self hash; a mismatch means the manifest was
// edited outside regen and every integrity finding that follows is floor.
export function verifyManifest(manifest: GuardrailManifest): boolean {
	return manifest.hash === manifestHash(manifest.artifacts);
}
