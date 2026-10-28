// SPEC §4.15.2–§4.15.3 + §4.15.6–§4.15.7: merge-gate reads and the CI base.
// Reads are pure over caller-supplied host data (rulesets, repo settings,
// workflow texts); the CLI fetches them through the kernel Net/Git ports, so
// this module never touches the network (§10.3) and fork PRs with read-only
// tokens degrade to advise, never to allow (EC-1, EC-6).
import { err, makeError, ok, type Result } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";

export interface ProtectionRead {
	readonly readable: boolean;
	readonly verifyRequired?: boolean;
	readonly forcePushBlocked?: boolean;
	readonly deletionBlocked?: boolean;
	// SPEC §4.9.3 + §4.15.2: classic repo setting ...
	readonly allowSquashMerge?: boolean;
	// ... or a ruleset's allowed_merge_methods without squash (S33).
	readonly rulesetMergeMethods?: ReadonlyArray<string>;
}

export interface BaseRefInput {
	readonly eventName: "pull_request" | "push" | "schedule" | "dispatch";
	readonly before?: string;
	readonly pullBaseSha?: string;
	readonly defaultBranch?: string;
	// SPEC §4.15.7 EC-2: false when the base is not reachable (shallow clone).
	readonly reachable?: boolean;
}

export interface PinnedUse {
	readonly file: string;
	readonly uses: string;
	readonly image?: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function advise(ruleId: string, message: string, remediation: string): Finding {
	return { ruleId, message, remediation };
}

function block(ruleId: string, message: string, remediation: string): Finding {
	return { ruleId, message, remediation };
}

// SPEC §4.15.2: reported not required → block; unreadable → advise (PRD
// §11.1). The same read feeds core/branch-protection below.
export function evaluateProtection(read?: ProtectionRead): Array<Finding> {
	if (read === undefined || !read.readable) {
		return [
			advise(
				"core/ci-required-check",
				"cannot confirm the verify check is required: branch protection is unreadable",
				"Grant the workflow read access to rulesets/branch protection, or confirm the required check by hand (EC-1, EC-6).",
			),
			advise(
				"core/branch-protection",
				"cannot confirm force-push, deletion and squash settings: branch protection is unreadable",
				"Grant the workflow read access to the repo settings and rulesets, or confirm them by hand (§4.15.2).",
			),
		];
	}
	const findings: Array<Finding> = [];
	if (read.verifyRequired !== true) {
		findings.push(
			block(
				"core/ci-required-check",
				"the verify check is not a required check on the default branch",
				"Add verify to the required checks of the branch ruleset (§4.15 EC-7).",
			),
		);
	}
	const squashExcluded =
		read.allowSquashMerge === false ||
		(read.rulesetMergeMethods !== undefined &&
			!read.rulesetMergeMethods.includes("squash"));
	if (!squashExcluded) {
		findings.push(
			block(
				"core/branch-protection",
				"squash merging is allowed and no ruleset excludes it",
				"Set allow_squash_merge to false and exclude squash from the ruleset allowed_merge_methods (§4.9.3, EC-11, S33).",
			),
		);
	}
	if (read.forcePushBlocked !== true || read.deletionBlocked !== true) {
		findings.push(
			block(
				"core/branch-protection",
				"force-push or deletion is not blocked on the default branch",
				"Block force-pushes and deletions on the default branch in settings and rulesets (§4.15.2).",
			),
		);
	}
	return findings;
}

// SPEC §4.15.1 + EC-2/EC-3: PRs read the base from the event; pushes use
// before, or the merge-base with the default branch when before is absent
// (new branch); an unreachable base is CDX-E503 and blocks.
export function resolveBaseRef(input: BaseRefInput): Result<string> {
	if (input.reachable === false) {
		return err(
			makeError(
				"CDX-E503",
				"CI base commit is unreachable (shallow clone despite config)",
				"Fetch with fetch-depth 0 and rerun; ci.verify needs the full base..head range (EC-2).",
			),
		);
	}
	if (input.eventName === "pull_request" && input.pullBaseSha !== undefined) {
		return ok(input.pullBaseSha);
	}
	const zero = "0000000000000000000000000000000000000000";
	if (
		input.before !== undefined &&
		input.before !== "" &&
		input.before !== zero
	) {
		return ok(input.before);
	}
	if (input.eventName === "push") {
		return ok(`merge-base(${input.defaultBranch ?? "main"},HEAD)`);
	}
	return ok(
		input.pullBaseSha ?? `merge-base(${input.defaultBranch ?? "main"},HEAD)`,
	);
}

function usesRef(uses: string): string | undefined {
	const at = uses.indexOf("@");
	return at >= 0 ? uses.slice(at + 1) : undefined;
}

// SPEC §4.15.2: every uses: in every workflow is a 40-hex SHA; every
// container/services image is digest-pinned (EC-5).
export function checkActionsPinned(
	uses: ReadonlyArray<PinnedUse>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const entry of uses) {
		const ref = entry.uses.includes("@") ? usesRef(entry.uses) : undefined;
		if (ref === undefined || !SHA_PATTERN.test(ref)) {
			findings.push(
				block(
					"core/ci-actions-pinned",
					`${entry.file} uses ${entry.uses} without a full commit SHA`,
					"Pin every uses: by full 40-hex commit SHA with the version as a trailing comment (EC-5).",
				),
			);
		}
		if (entry.image !== undefined && !entry.image.includes("@sha256:")) {
			findings.push(
				block(
					"core/ci-actions-pinned",
					`${entry.file} runs container ${entry.image} without a digest pin`,
					"Pin every container/services image by digest (EC-5).",
				),
			);
		}
	}
	return findings;
}
