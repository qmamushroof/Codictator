// SPEC §4.14: manifest, drift and tamper checks, self-protection and
// git-hook installation. Owns the §7.14 guardrail manifest format. The
// tested contracts stay on this entry; helpers live beside it (SPEC §3.3).
import type { CheckContext, Finding } from "../engine/index.ts";
import {
	checkDrift as checkDriftImpl,
	type DriftSnapshot,
	type FileContent,
	type InstalledHook,
} from "./drift.ts";
import {
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
	type HookInstallPlan,
	type HookName,
	hookInstallPlan,
	renderHookScript,
	renderHuskyBlock,
} from "./hooks.ts";
import type { GuardrailManifest, ManifestArtifact } from "./manifest.ts";
import { buildManifest, manifestHash, verifyManifest } from "./manifest.ts";
import {
	type CommitInRange,
	checkCommitTrailers,
	checkPackageManifestEdit,
	checkSelfProtection as checkProtection,
	isProtectedPath,
} from "./self-protection.ts";

export type {
	CommitInRange,
	DriftSnapshot,
	FileContent,
	GuardrailManifest,
	HookInstallPlan,
	HookName,
	InstalledHook,
	ManifestArtifact,
};
export {
	buildManifest,
	checkCommitTrailers,
	checkPackageManifestEdit,
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
	hookInstallPlan,
	isProtectedPath,
	manifestHash,
	renderHookScript,
	renderHuskyBlock,
	verifyManifest,
};

// SPEC §4.14.1: manifest comparison for drift; without a snapshot only the
// manifest self hash and hook availability fail closed (§10.3).
export function checkDrift(
	ctx: CheckContext,
	manifest: GuardrailManifest,
	snapshot?: DriftSnapshot,
): Array<Finding> {
	return checkDriftImpl(ctx, manifest, snapshot);
}

// SPEC §4.14.3: self-protection (no bypass of hooks or required checks).
export function checkSelfProtection(
	ctx: CheckContext,
	command: ReadonlyArray<string>,
): Array<Finding> {
	return checkProtection(ctx, command);
}
