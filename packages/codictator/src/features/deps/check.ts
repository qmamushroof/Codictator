// SPEC §4.8.5 and §4.8.8: the evaluation-path check. Anything needing the
// snapshot, lockfile bytes or bot files runs in evaluateDepVerdicts once
// the caller supplies it; without that data this reports only what the
// ranges themselves prove, never a guess. With a Net port and no snapshot,
// the names fetch fresh (L4/L5) and a transport failure blocks fail-closed
// with CDX-E401 (EC-5).
import type { Fs, Net, Result } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";
import type { DepEvalInput } from "./eval.ts";
import { uniqueDeps } from "./eval.ts";
import type { Manifest, RegistrySnapshot } from "./index.ts";
import { isExactNpmPin, isUnversionedNpmSource } from "./npm.ts";
import { buildSnapshot, fetchNpmPackument } from "./registry.ts";
import {
	depErrorFinding,
	evaluateDepVerdicts,
	manifestToEval,
} from "./verdicts.ts";

// SPEC §4.8.8: the evaluation-path context. Every field is optional and
// defaults to "not supplied" (never "clean"), so existing two-argument
// callers keep their intrinsic-only behaviour. The enforcer layer supplies
// the snapshot, the Net port for the fetch path (EC-5), the Fs port for
// lockfile and bot reads, and the platform capabilities for EC-13.
export interface DepCheckContext {
	readonly snapshot?: RegistrySnapshot;
	readonly unpublished?: ReadonlyArray<string>;
	readonly npmrc?: { readonly path: string; readonly text: string };
	readonly allowedRegistryHosts?: ReadonlyArray<string>;
	readonly platformCaps?: ReadonlyArray<string>;
	readonly net?: Net;
	readonly fs?: Fs;
	readonly registryBaseUrl?: string;
	readonly fetchSleep?: (ms: number) => Promise<void>;
}

export async function checkDeps(
	ctx: CheckContext,
	manifests: ReadonlyArray<Manifest>,
	depsContext: DepCheckContext = {},
): Promise<Array<Finding>> {
	let snapshot = depsContext.snapshot;
	if (snapshot === undefined && depsContext.net !== undefined) {
		const fetched = await fetchEvaluationSnapshot(
			depsContext.net,
			manifests,
			ctx.now,
			depsContext.registryBaseUrl,
			depsContext.fetchSleep,
		);
		if (!fetched.ok) {
			return [
				depErrorFinding(
					"core/dep-no-vulnerable",
					manifests[0]?.path ?? "package.json",
					fetched.error,
					"Retry the sweep; without registry data dependency changes block fail-closed.",
				),
			];
		}
		snapshot = fetched.value;
	}
	const input: DepEvalInput = {
		manifests: manifests.map(manifestToEval),
		now: ctx.now,
		...(snapshot === undefined ? {} : { snapshot }),
		...(depsContext.unpublished === undefined
			? {}
			: { unpublished: depsContext.unpublished }),
		...(depsContext.npmrc === undefined ? {} : { npmrc: depsContext.npmrc }),
		...(depsContext.allowedRegistryHosts === undefined
			? {}
			: { allowedRegistryHosts: depsContext.allowedRegistryHosts }),
		...(depsContext.platformCaps === undefined
			? {}
			: { platformCaps: depsContext.platformCaps }),
	};
	const evaluated = evaluateDepVerdicts(input);
	const findings: Array<Finding> = [...evaluated.findings];
	if (snapshot === undefined) {
		for (const { path, dep } of uniqueDeps(input.manifests)) {
			if (!isExactNpmPin(dep.range) || isUnversionedNpmSource(dep.range)) {
				continue;
			}
			const parsed = dep.range.replace(/^v/, "");
			if (/-/.test(parsed) && !/^\d+\.\d+\.\d+$/.test(parsed)) {
				findings.push({
					ruleId: "core/dep-latest-stable",
					path,
					message: `${dep.name}@${dep.range} in ${path} is a prerelease, never stable`,
					remediation: `Pin ${dep.name} to a stable release.`,
				});
			}
		}
	}
	return findings;
}

async function fetchEvaluationSnapshot(
	net: Net,
	manifests: ReadonlyArray<Manifest>,
	now: string,
	baseUrl: string | undefined,
	sleep: ((ms: number) => Promise<void>) | undefined,
): Promise<Result<RegistrySnapshot>> {
	const names = [
		...new Set(manifests.flatMap((m) => m.dependencies.map((d) => d.name))),
	].sort();
	const docs = [];
	for (const name of names) {
		const fetched = await fetchNpmPackument(net, name, {
			...(baseUrl === undefined ? {} : { baseUrl }),
			...(sleep === undefined ? {} : { sleep }),
		});
		if (!fetched.ok) {
			return fetched;
		}
		docs.push(fetched.value);
	}
	return {
		ok: true,
		value: buildSnapshot("npm", now, docs, {}),
	};
}
