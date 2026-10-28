// SPEC §4.8.5 verdicts over manifests plus snapshot. The orchestration and
// the manifest-intrinsic rows live here; pinned rows needing registry data
// live in snapshot-verdicts.ts and the §6.1 catalogue in capabilities.ts.

import { makeError } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import { capabilityOf, DEFAULT_LICENSE_ALLOW } from "./capabilities.ts";
import {
	type DepEvalInput,
	type DepEvaluation,
	type EvalManifest,
	pinFinding,
	uniqueDeps,
} from "./eval.ts";
import { lockfileMismatches, parsePackageLock } from "./lockfile.ts";
import type { NpmDepKind } from "./npm.ts";
import { isExactNpmPin } from "./npm.ts";
import {
	NPM_PUBLIC_REGISTRY_HOST,
	parseNpmrc,
	privateRegistryHosts,
} from "./npmrc.ts";
import {
	checkPinnedVerdicts,
	pinnedOrUnversionedNote,
	snapshotForm,
} from "./snapshot-verdicts.ts";
import { DEFAULT_DEP_LAG_PARAMS } from "./stable.ts";

export function manifestToEval(manifest: {
	readonly path: string;
	readonly dependencies: ReadonlyArray<{
		readonly name: string;
		readonly range: string;
		readonly kind?: NpmDepKind;
	}>;
}): EvalManifest {
	return {
		path: manifest.path,
		dependencies: manifest.dependencies.map((dep) => ({
			name: dep.name,
			range: dep.range,
			kind: dep.kind ?? "prod",
		})),
	};
}

// SPEC §4.8.5 verdicts over manifests plus snapshot. Anything needing data
// the caller did not supply is skipped, never default-allowed: absence of a
// snapshot entry means "not fetched", not "clean".
export function evaluateDepVerdicts(input: DepEvalInput): DepEvaluation {
	const findings: Array<Finding> = [];
	const notes: Array<string> = [];
	checkExactPins(input, findings);
	checkLockfiles(input, findings);
	checkNewNeedsReason(input, findings);
	checkOnePerCapability(input, findings);
	checkNpmrc(input, findings);
	if (input.snapshot !== undefined) {
		checkSnapshotVerdicts(input, findings, notes);
	}
	return { findings, notes };
}

function checkExactPins(input: DepEvalInput, findings: Array<Finding>): void {
	for (const manifest of input.manifests) {
		for (const dep of manifest.dependencies) {
			if (dep.kind === "peer") {
				continue;
			}
			if (!isExactNpmPin(dep.range)) {
				findings.push(pinFinding(manifest.path, dep.name, dep.range));
			}
		}
	}
}

function lockfileFindingsFor(
	manifest: EvalManifest,
	text: string,
): ReadonlyArray<Finding> {
	const parsed = parsePackageLock(text);
	if (!parsed.ok) {
		return [
			{
				ruleId: "core/dep-lockfile",
				path: manifest.path,
				code: parsed.error.code,
				message: `lockfile for ${manifest.path} is unparseable`,
				remediation: `Regenerate the lockfile for ${manifest.path} with the ecosystem tool.`,
			},
		];
	}
	const mismatched = lockfileMismatches(manifest.dependencies, {
		lockfileVersion: 3,
		pinned: parsed.value.pinned,
	});
	return mismatched.map((name) => ({
		ruleId: "core/dep-lockfile",
		path: manifest.path,
		message: `${name} in ${manifest.path} is out of sync with the lockfile`,
		remediation: `Regenerate the lockfile for ${manifest.path} with the ecosystem tool.`,
	}));
}

function checkLockfiles(input: DepEvalInput, findings: Array<Finding>): void {
	if (input.lockfiles === undefined) {
		return;
	}
	for (const manifest of input.manifests) {
		if (!(manifest.path in input.lockfiles)) {
			continue;
		}
		const text = input.lockfiles[manifest.path];
		if (text === null || text === undefined) {
			findings.push({
				ruleId: "core/dep-lockfile",
				path: manifest.path,
				message: `no lockfile committed for ${manifest.path}`,
				remediation: `Commit the lockfile for ${manifest.path}.`,
			});
			continue;
		}
		for (const finding of lockfileFindingsFor(manifest, text)) {
			findings.push(finding);
		}
	}
}

function checkNewNeedsReason(
	input: DepEvalInput,
	findings: Array<Finding>,
): void {
	if (input.newDeps === undefined) {
		return;
	}
	for (const manifest of input.manifests) {
		for (const dep of manifest.dependencies) {
			if (
				input.newDeps.includes(dep.name) &&
				input.addedReasons?.[dep.name] !== true
			) {
				findings.push({
					ruleId: "core/dep-new-needs-reason",
					path: manifest.path,
					message: `${dep.name} in ${manifest.path} has no recorded reason`,
					remediation: `Record why ${dep.name} is needed in ${manifest.path}.`,
				});
			}
		}
	}
}

function checkOnePerCapability(
	input: DepEvalInput,
	findings: Array<Finding>,
): void {
	const byCapability = new Map<string, Array<{ path: string; name: string }>>();
	for (const { path, dep } of uniqueDeps(input.manifests)) {
		const capability = capabilityOf(dep.name);
		if (capability === undefined) {
			continue;
		}
		const holders = byCapability.get(capability) ?? [];
		holders.push({ path, name: dep.name });
		byCapability.set(capability, holders);
	}
	for (const [capability, holders] of [...byCapability.entries()].sort()) {
		const first = holders[0];
		const second = holders[1];
		if (first !== undefined && second !== undefined) {
			findings.push({
				ruleId: "core/dep-one-per-capability",
				path: first.path,
				message: `${first.name} and ${second.name} both cover ${capability}`,
				remediation: `Remove ${second.name}; the kept package already covers ${capability}.`,
			});
		}
	}
}

function checkNpmrc(input: DepEvalInput, findings: Array<Finding>): void {
	if (input.npmrc === undefined) {
		return;
	}
	const parsed = parseNpmrc(input.npmrc.text);
	if (input.saveExactRequired === true && parsed.saveExact !== true) {
		findings.push({
			ruleId: "core/dep-exact-pin",
			path: input.npmrc.path,
			message: `${input.npmrc.path} lacks the owned save-exact=true entry`,
			remediation: `Set save-exact=true in ${input.npmrc.path}.`,
		});
	}
	const allowed = input.allowedRegistryHosts ?? [];
	for (const host of privateRegistryHosts(parsed)) {
		if (host !== NPM_PUBLIC_REGISTRY_HOST && !allowed.includes(host)) {
			findings.push({
				ruleId: "core/dep-exact-pin",
				path: input.npmrc.path,
				code: "CDX-E702",
				message: `private registry ${host} is not on the network allowlist`,
				remediation: `Add ${host} via config.network.registries (SPEC §9.2).`,
			});
		}
	}
}

function checkSnapshotVerdicts(
	input: DepEvalInput,
	findings: Array<Finding>,
	notes: Array<string>,
): void {
	const params = { ...DEFAULT_DEP_LAG_PARAMS, ...input.params };
	const allow = input.licenseAllow ?? DEFAULT_LICENSE_ALLOW;
	const snapshot = input.snapshot;
	if (snapshot === undefined) {
		return;
	}
	for (const { path, dep } of uniqueDeps(input.manifests)) {
		if (dep.kind === "peer") {
			continue;
		}
		const form = snapshotForm(dep.range);
		if (form === "unversioned") {
			notes.push(pinnedOrUnversionedNote(path, dep.name));
			continue;
		}
		if (form !== "pinned") {
			continue;
		}
		const pinned = dep.range.replace(/^v/, "");
		for (const finding of checkPinnedVerdicts(
			{
				snapshot,
				params,
				allow,
				path,
				dep,
				unpublished: input.unpublished ?? [],
			},
			pinned,
			notes,
		)) {
			findings.push(finding);
		}
	}
}

export function depErrorFinding(
	ruleId: string,
	path: string,
	error: { readonly code: string; readonly message: string },
	remediation: string,
): Finding {
	return {
		ruleId,
		path,
		code: error.code,
		message: error.message,
		remediation,
	};
}

export function makeDepError(
	code: string,
	message: string,
	remediation: string,
): {
	readonly code: string;
	readonly message: string;
	readonly remediation: string;
} {
	return makeError(code, message, remediation);
}
