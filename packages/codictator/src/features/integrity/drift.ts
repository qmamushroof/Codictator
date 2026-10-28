// SPEC §4.14.1–§4.14.2: drift (working tree vs manifest) and tamper checks.
// The caller supplies a snapshot of the working tree, so this module stays
// pure and port-free; the CLI builds the snapshot through kernel ports.
import { sha256Text } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";
import { EXPECTED_HOOKS_PATH } from "./hooks.ts";
import { type GuardrailManifest, verifyManifest } from "./manifest.ts";

export interface FileContent {
	readonly path: string;
	readonly content: string;
}

export interface InstalledHook {
	readonly name: string;
	readonly executable: boolean;
}

export interface DriftSnapshot {
	readonly files: ReadonlyArray<FileContent>;
	// SPEC §4.14.2: git core.hooksPath; absent means unreadable.
	readonly hooksPath?: string;
	readonly hooksExecutable?: boolean;
	// SPEC §4.14.6 EC-2: the hook files actually present; a deleted hook is
	// reported here at L0/L4 even though L3 (the hook itself) is gone.
	readonly installedHooks?: ReadonlyArray<InstalledHook>;
	// SPEC §4.14.2: installed engine version; absent means launcher missing.
	readonly engineVersion?: string;
	readonly expectedHooksPath?: string;
}

// SPEC §4.6.2 managed-block markers, cited here for block-mode hashing.
const BLOCK_BEGIN = "<!-- codictator:begin -->";
const BLOCK_END = "<!-- codictator:end -->";

function manifestFinding(message: string, remediation: string): Finding {
	return {
		ruleId: "core/guardrail-manifest",
		code: "CDX-E501",
		message,
		remediation,
	};
}

// SPEC §4.14.6 EC-5: hashes normalize first, so autocrlf cannot fake drift.
function hashForMode(mode: string, content: string): string | undefined {
	if (mode === "file") {
		return sha256Text(content);
	}
	if (mode === "entries") {
		// SPEC §4.14.1: entries mode hashes the canonical projection of owned
		// entries; the caller projects before snapshotting, so user additions
		// outside the projection (EC-6) never reach this comparison.
		return sha256Text(content);
	}
	const first = content.indexOf(BLOCK_BEGIN);
	const last = content.indexOf(BLOCK_END);
	if (first < 0 || last < 0 || first >= last) {
		return undefined;
	}
	const repeats = content.indexOf(BLOCK_BEGIN, first + BLOCK_BEGIN.length) >= 0;
	if (repeats) {
		return undefined;
	}
	return sha256Text(content.slice(first, last + BLOCK_END.length));
}

function checkArtifact(
	path: string,
	mode: string,
	expected: string,
	actual: Map<string, string>,
): Array<Finding> {
	const content = actual.get(path);
	if (content === undefined) {
		return [
			{
				...manifestFinding(
					`generated artifact ${path} is missing from the working tree`,
					"Restore it with `codictator regen`; delete it only by dropping its owner from config first (§4.14 EC-10).",
				),
				path,
			},
		];
	}
	const hash = hashForMode(mode, content);
	if (hash === undefined) {
		return [
			{
				...manifestFinding(
					`managed block markers in ${path} are malformed or duplicated`,
					"Restore the single managed block with `codictator regen` (§4.14 EC-6 keeps user text outside the block).",
				),
				path,
				code: "CDX-E501",
			},
		];
	}
	if (hash !== expected) {
		return [
			{
				...manifestFinding(
					`generated artifact ${path} differs from its manifest hash`,
					"Never hand-edit generated artifacts; change config and run `codictator regen` (§4.14.5).",
				),
				path,
			},
		];
	}
	return [];
}

const REQUIRED_HOOKS = ["pre-commit", "commit-msg", "pre-push"];

function hooksFinding(message: string, remediation: string): Finding {
	return { ruleId: "core/hooks-active", message, remediation };
}

function checkInstalledHooks(
	installed: ReadonlyArray<InstalledHook>,
): Array<Finding> {
	const present = new Set(installed.map((hook) => hook.name));
	for (const required of REQUIRED_HOOKS) {
		if (!present.has(required)) {
			// SPEC §4.14.6 EC-2: L0 and L4 report the deleted hook; L3 cannot.
			return [
				hooksFinding(
					`hook ${required} is missing from the installed hooks dir`,
					"Run `codictator install-hooks` to reinstall it (EC-2).",
				),
			];
		}
	}
	for (const hook of installed) {
		if (!hook.executable) {
			return [
				hooksFinding(
					`hook ${hook.name} lost its executable bit (for example after a Windows commit)`,
					"Run `git update-index --chmod=+x` on the hook and keep the .gitattributes entry from install-hooks (§4.14 EC-12).",
				),
			];
		}
	}
	return [];
}

function checkHooks(snapshot: DriftSnapshot): Array<Finding> {
	const expected = snapshot.expectedHooksPath ?? EXPECTED_HOOKS_PATH;
	if (snapshot.installedHooks !== undefined) {
		const findings = checkInstalledHooks(snapshot.installedHooks);
		if (findings.length > 0) {
			return findings;
		}
	}
	if (snapshot.hooksPath === undefined) {
		return [
			{
				ruleId: "core/hooks-active",
				message:
					"hook state is unavailable: cannot confirm hooks are installed",
				remediation: `Run \`codictator install-hooks\` to reinstall the hooks and point core.hooksPath at ${expected} (§4.14 EC-9).`,
			},
		];
	}
	if (snapshot.hooksPath !== expected) {
		return [
			{
				ruleId: "core/hooks-active",
				message: `core.hooksPath points at ${snapshot.hooksPath}, not the installed hooks dir ${expected}`,
				remediation: `Run \`codictator install-hooks\` to reinstall the hooks (§4.14 EC-9).`,
			},
		];
	}
	if (snapshot.hooksExecutable === false) {
		return [
			{
				ruleId: "core/hooks-active",
				message:
					"a hook file lost its executable bit (for example after a Windows commit)",
				remediation:
					"Run `git update-index --chmod=+x` on the hook and keep the .gitattributes entry from install-hooks (§4.14 EC-12).",
			},
		];
	}
	return [];
}

// SPEC §4.14.2: L0 detection blocks all tool calls except regen, status and
// reads, so an agent repairs guardrails before working. Every finding here
// is floor and is listed first in the CI summary.
export function checkDrift(
	_ctx: CheckContext,
	manifest: GuardrailManifest,
	snapshot?: DriftSnapshot,
): Array<Finding> {
	const findings: Array<Finding> = [];
	if (!verifyManifest(manifest)) {
		findings.push(
			manifestFinding(
				"the manifest itself was edited outside regen (self hash mismatch)",
				"Regenerate with `codictator regen`; guardrails change only through config (§4.14.5).",
			),
		);
	}
	if (snapshot === undefined) {
		// SPEC §10.3 fail-closed: with no working-tree evidence the hooks
		// cannot be confirmed active, so report rather than allow.
		findings.push(...checkHooks({ files: [] }));
		return findings;
	}
	const actual = new Map<string, string>();
	for (const file of snapshot.files) {
		actual.set(file.path.replaceAll("\\", "/"), file.content);
	}
	for (const artifact of manifest.artifacts) {
		findings.push(
			...checkArtifact(artifact.path, artifact.mode, artifact.hash, actual),
		);
	}
	findings.push(...checkHooks(snapshot));
	if (
		snapshot.engineVersion !== undefined &&
		snapshot.engineVersion !== manifest.codictator
	) {
		findings.push({
			ruleId: "core/engine-version-match",
			message: `installed engine ${snapshot.engineVersion} does not match config ${manifest.codictator}`,
			remediation:
				"Install the pinned engine version, then rerun `codictator regen` (§4.14.2).",
		});
	}
	if (snapshot.engineVersion === undefined) {
		findings.push({
			ruleId: "core/engine-version-match",
			message: "the launcher is missing: no installed engine found",
			remediation:
				"Run `npm ci --ignore-scripts` (or install the tool dir) so the launcher resolves (§4.14.2).",
		});
	}
	return findings;
}
