// SPEC §4.13.1: the adoption sequence. Detection is pure over
// caller-supplied file lists and manifest text; the caller reads the repo
// through its ports, so this module never touches the OS (SPEC §3.3).

import type { Result } from "../../kernel/index.ts";
import { makeError } from "../../kernel/index.ts";
import {
	detectUpgradeBots,
	evaluateDepVerdicts,
	isExactNpmPin,
	manifestToEval,
	parsePackageJson,
	type UpgradeBot,
} from "../deps/index.ts";
import type { Finding } from "../engine/index.ts";
import type { Baseline } from "./types.ts";

export interface BrownfieldManifest {
	readonly path: string;
	readonly text: string;
}

export interface BrownfieldInput {
	readonly files: ReadonlyArray<string>;
	readonly manifests: ReadonlyArray<BrownfieldManifest>;
	readonly lockfiles: Readonly<Record<string, string | null>>;
	readonly now: string;
}

export interface LoosePin {
	readonly path: string;
	readonly name: string;
	readonly range: string;
}

export interface BrownfieldDetection {
	readonly bot: UpgradeBot;
	readonly loosePins: ReadonlyArray<LoosePin>;
	readonly missingLockfiles: ReadonlyArray<string>;
	readonly findings: ReadonlyArray<Finding>;
}

function collectManifestLoosePins(
	manifest: BrownfieldManifest,
	loosePins: Array<LoosePin>,
): void {
	const parsed = parsePackageJson(manifest.text);
	if (!parsed.ok) {
		return;
	}
	for (const dep of parsed.value.dependencies) {
		if (dep.kind !== "peer" && !isExactNpmPin(dep.range)) {
			loosePins.push({
				path: manifest.path,
				name: dep.name,
				range: dep.range,
			});
		}
	}
}

function compareLoosePins(left: LoosePin, right: LoosePin): number {
	if (left.path !== right.path) {
		return left.path < right.path ? -1 : 1;
	}
	if (left.name !== right.name) {
		return left.name < right.name ? -1 : 1;
	}
	return 0;
}

function collectLoosePins(
	manifests: ReadonlyArray<BrownfieldManifest>,
): Array<LoosePin> {
	const loosePins: Array<LoosePin> = [];
	for (const manifest of manifests) {
		collectManifestLoosePins(manifest, loosePins);
	}
	loosePins.sort(compareLoosePins);
	return loosePins;
}

function missingManifestLockfiles(
	manifests: ReadonlyArray<BrownfieldManifest>,
	lockfiles: Readonly<Record<string, string | null>>,
): Array<string> {
	return manifests
		.filter((manifest) => lockfiles[manifest.path] === null)
		.map((manifest) => manifest.path)
		.sort();
}

// SPEC §4.13.1 steps 1–2: brownfield signals are loose pins (floor) and
// manifests without a committed lockfile. Bot detection follows §4.8.6.
export function detectBrownfield(input: BrownfieldInput): BrownfieldDetection {
	const bot = detectUpgradeBots(input.files);
	const loosePins = collectLoosePins(input.manifests);
	const missingLockfiles = missingManifestLockfiles(
		input.manifests,
		input.lockfiles,
	);
	const evaluated = evaluateDepVerdicts({
		manifests: input.manifests.map((manifest) => {
			const parsed = parsePackageJson(manifest.text);
			if (!parsed.ok) {
				return { path: manifest.path, dependencies: [] };
			}
			return manifestToEval({
				path: manifest.path,
				dependencies: parsed.value.dependencies.map((dep) => ({
					name: dep.name,
					range: dep.range,
					kind: dep.kind,
				})),
			});
		}),
		now: input.now,
		lockfiles: input.lockfiles,
	});
	return {
		bot,
		loosePins,
		missingLockfiles,
		findings: [...evaluated.findings],
	};
}

// SPEC §4.13.1 step 3 and §7.6: record current findings as the baseline.
// Keys are "<ruleId>@<measureVersion>" with per-path counts; zero counts are
// removed and keys sort, so regeneration is byte-identical.
export function baselineFromFindings(
	findings: ReadonlyArray<Finding>,
): Baseline {
	const counts = new Map<string, Map<string, number>>();
	for (const finding of findings) {
		const key = `${finding.ruleId}@1`;
		let byPath = counts.get(key);
		if (byPath === undefined) {
			byPath = new Map<string, number>();
			counts.set(key, byPath);
		}
		const metric = finding.path ?? "repo";
		byPath.set(metric, (byPath.get(metric) ?? 0) + 1);
	}
	const entries: Record<string, Record<string, number>> = {};
	for (const key of [...counts.keys()].sort()) {
		const byPath = counts.get(key);
		if (byPath === undefined) {
			continue;
		}
		const metrics: Record<string, number> = {};
		for (const metric of [...byPath.keys()].sort()) {
			const count = byPath.get(metric) ?? 0;
			if (count > 0) {
				metrics[metric] = count;
			}
		}
		if (Object.keys(metrics).length > 0) {
			entries[key] = metrics;
		}
	}
	return { version: 1, entries };
}

export interface FloorPinResult {
	readonly text: string;
	readonly pinned: ReadonlyArray<string>;
}

// SPEC §4.13.1 step 4: range → exact pin at the lockfile-resolved version, a
// mechanical step needing no human decision. The resolved versions come from
// the caller (the lockfile); a loose pin without one fails closed with
// CDX-E903 instead of guessing a version.
export function applyFloorPins(
	manifestText: string,
	resolved: Readonly<Record<string, string>>,
): Result<FloorPinResult> {
	const parsed = parsePackageJson(manifestText);
	if (!parsed.ok) {
		return { ok: false, error: parsed.error };
	}
	const missing = parsed.value.dependencies
		.filter(
			(dep) =>
				dep.kind !== "peer" &&
				!isExactNpmPin(dep.range) &&
				resolved[dep.name] === undefined,
		)
		.map((dep) => dep.name)
		.sort();
	if (missing.length > 0) {
		return {
			ok: false,
			error: makeError(
				"CDX-E903",
				`no lockfile-resolved version for ${missing.join(", ")}`,
				`Supply the lockfile-resolved version of ${missing.join(", ")} before pinning.`,
			),
		};
	}
	let text = manifestText;
	const pinned: Array<string> = [];
	for (const dep of parsed.value.dependencies) {
		if (dep.kind === "peer" || isExactNpmPin(dep.range)) {
			continue;
		}
		const exact = resolved[dep.name] ?? dep.range;
		text = text.replace(
			`"${dep.name}": "${dep.range}"`,
			`"${dep.name}": "${exact}"`,
		);
		pinned.push(dep.name);
	}
	pinned.sort();
	return { ok: true, value: { text, pinned } };
}
