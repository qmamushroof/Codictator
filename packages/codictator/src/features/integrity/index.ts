// SPEC §4.14: manifest, drift, self-protection. Owns the §7.14 guardrail
// manifest format.
import type { CheckContext, Finding } from "../engine/index.ts";

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

// SPEC §4.14.1: manifest comparison for drift.
export function checkDrift(
	_ctx: CheckContext,
	_manifest: GuardrailManifest,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.14.1");
}

// SPEC §4.14.3: self-protection (no bypass of hooks or required checks).
export function checkSelfProtection(
	_ctx: CheckContext,
	_command: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.14.3");
}
