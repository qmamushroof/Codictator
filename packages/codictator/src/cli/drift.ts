// SPEC §4.14.2: manifest drift findings. The manifest self-hash is verified
// first (an edit outside regen fails closed); then every artifact hash is
// recomputed and compared, so drift names its file.
import { verifyManifest } from "../features/integrity/index.ts";
import type { Finding } from "../kernel/index.ts";
import { normalizeText, parseJson, sha256Text } from "../kernel/index.ts";
import { portsFor } from "./shared.ts";

export interface ManifestRecord {
	readonly artifacts: ReadonlyArray<{ path: string; hash: string }>;
}

function manifestProblem(
	message: string,
	remediation: string,
	path?: string,
): Finding {
	return {
		ruleId: "core/guardrail-manifest",
		...(path === undefined ? {} : { path }),
		message,
		remediation,
	};
}

function readManifestRecord(text: string): {
	record?: ManifestRecord;
	problem?: string;
} {
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return { problem: "manifest is not JSON" };
	}
	const record = parsed.value as { artifacts?: unknown; hash?: unknown };
	if (!verifyManifest(record as never)) {
		return { problem: "manifest edited outside regen" };
	}
	const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
	const kept: Array<{ path: string; hash: string }> = [];
	for (const artifact of artifacts) {
		if (typeof artifact !== "object" || artifact === null) {
			continue;
		}
		const entry = artifact as { path?: unknown; hash?: unknown };
		if (typeof entry.path !== "string" || typeof entry.hash !== "string") {
			continue;
		}
		if (entry.path !== ".codictator/manifest.json") {
			kept.push({ path: entry.path, hash: entry.hash });
		}
	}
	return { record: { artifacts: kept } };
}

async function checkArtifactHashes(
	root: string,
	artifacts: ReadonlyArray<{ path: string; hash: string }>,
): Promise<Array<Finding>> {
	const ports = await portsFor(root);
	const findings: Array<Finding> = [];
	if (!ports.ok) {
		findings.push(
			manifestProblem(
				"guardrail manifest unreadable",
				"Restore it with `codictator regen` (EC-4).",
			),
		);
		return findings;
	}
	for (const artifact of artifacts) {
		const content = await ports.value.fs.readText(artifact.path);
		if (!content.ok) {
			findings.push(
				manifestProblem(
					"guardrail artifact missing or unreadable",
					"Restore it with `codictator regen`; delete it only by dropping its owner from config first.",
					artifact.path,
				),
			);
			continue;
		}
		if (sha256Text(normalizeText(content.value)) !== artifact.hash) {
			findings.push(
				manifestProblem(
					"guardrail artifact differs from its manifest entry",
					"Restore it with `codictator regen`; never hand-edit generated artifacts.",
					artifact.path,
				),
			);
		}
	}
	return findings;
}

// SPEC §4.14.2 + §4.19.6 EC-7: manifest drift findings plus the
// effective-config cache round-trip (key mismatch re-resolves).
export async function driftFindings(
	root: string,
	layer: string | undefined,
): Promise<{ findings: Array<Finding>; note: string }> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return { findings: [], note: "unverified (ports failed)" };
	}
	const seen = await ports.value.fs.exists(".codictator/manifest.json");
	if (!seen.ok || !seen.value) {
		return { findings: [], note: "unverified (no manifest)" };
	}
	const text = await ports.value.fs.readText(".codictator/manifest.json");
	if (!text.ok) {
		return {
			findings: [
				manifestProblem(
					"guardrail manifest unreadable",
					"Restore it with `codictator regen` (EC-4).",
				),
			],
			note: "manifest unreadable",
		};
	}
	const loaded = readManifestRecord(text.value);
	if (loaded.record === undefined) {
		return {
			findings: [
				manifestProblem(
					`guardrail ${loaded.problem ?? "manifest invalid"}`,
					"Restore it with `codictator regen`; change config and regen instead.",
				),
			],
			note: loaded.problem ?? "manifest invalid",
		};
	}
	const findings = await checkArtifactHashes(root, loaded.record.artifacts);
	const scoped = layer === undefined ? "" : ` scoped to ${layer}`;
	return { findings, note: `manifest checked${scoped}` };
}
