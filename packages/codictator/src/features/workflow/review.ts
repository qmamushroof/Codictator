// SPEC §4.12.4: the review gate. The reviewed object is the staged index
// tree id; the reviewer runs as a fresh session; findings resolve by
// severity; the round cap escalates through the loop breaker path.
import type { CheckContext, Finding } from "../engine/index.ts";

export type ReviewSeverity = "blocker" | "major" | "minor" | "nit";

export interface ReviewFinding {
	readonly id: string;
	readonly severity: string;
	readonly path: string;
	readonly line?: number;
	readonly message: string;
}

export interface ReviewFindingsFile {
	readonly version: 1;
	readonly findings: ReadonlyArray<ReviewFinding>;
	readonly tree?: string;
	readonly reviewerSession?: string;
	readonly identity?: "observed" | "declared";
	readonly round?: number;
}

export interface ReviewCheckDetail {
	readonly authorSessions?: ReadonlyArray<string>;
	readonly reviewerSessions?: ReadonlyArray<string>;
	readonly tree?: string;
	readonly maxRounds?: number;
	readonly completedRounds?: number;
}

const SEVERITIES: ReadonlyArray<string> = ["blocker", "major", "minor", "nit"];

function malformedReason(file: ReviewFindingsFile): string | undefined {
	if (!Array.isArray(file.findings)) {
		return "findings is not a list";
	}
	const seen = new Set<string>();
	for (const finding of file.findings) {
		if (
			typeof finding.id !== "string" ||
			typeof finding.severity !== "string" ||
			typeof finding.path !== "string" ||
			typeof finding.message !== "string" ||
			finding.id.length === 0 ||
			finding.message.length === 0
		) {
			return "a finding misses id, severity, path or message";
		}
		if (!SEVERITIES.includes(finding.severity)) {
			return `severity "${finding.severity}" is not blocker, major, minor or nit`;
		}
		if (seen.has(finding.id)) {
			return `duplicate finding id "${finding.id}"`;
		}
		seen.add(finding.id);
	}
	// SPEC §4.12.4 Bind/Submit: a submittable round binds the staged tree
	// and the reviewer session. An empty findings list is a pass only once
	// bound; without either the round cannot be recorded.
	if (file.tree === undefined || file.reviewerSession === undefined) {
		return "the round binds no staged tree or reviewer session";
	}
	return undefined;
}

// SPEC §4.12.4: review submit refuses a reviewer from the author sessions
// or from any earlier round (CDX-E605). Identity comes from the recorded
// tool event; without an adapter the round is marked declared.
function freshnessRefusal(
	file: ReviewFindingsFile,
	detail: ReviewCheckDetail,
): Finding | undefined {
	const reviewer = file.reviewerSession;
	if (reviewer === undefined) {
		return {
			ruleId: "core/review-gate",
			code: "CDX-E605",
			message: "reviewer session unknown; reviewer freshness cannot be proven",
			remediation:
				"Re-submit with --session from a fresh session that wrote no task file.",
		};
	}
	const authors = detail.authorSessions ?? [];
	const earlier = detail.reviewerSessions ?? [];
	if (authors.includes(reviewer) || earlier.includes(reviewer)) {
		return {
			ruleId: "core/review-gate",
			code: "CDX-E605",
			message: `reviewer session "${reviewer}" is not fresh`,
			remediation:
				"Re-submit from a fresh session that wrote no task file and ran no earlier round.",
		};
	}
	return undefined;
}

// SPEC §4.12.4 gate: last round tree equals staged, zero open
// blocker/major, exceptions acknowledged, rounds under the cap.
export async function checkReview(
	ctx: CheckContext,
	file: ReviewFindingsFile,
	detail: ReviewCheckDetail = {},
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	const malformed = malformedReason(file);
	if (malformed !== undefined) {
		findings.push({
			ruleId: "core/review-gate",
			code: "CDX-E607",
			message: `review findings file invalid: ${malformed}; the round is not recorded`,
			remediation:
				"Submit findings as { id, severity, path, line?, message } bound to the staged tree and reviewer session.",
		});
	}
	const refusal = freshnessRefusal(file, detail);
	if (refusal !== undefined) {
		findings.push(refusal);
	}
	const openBlockers = Array.isArray(file.findings)
		? file.findings.filter(
				(entry) => entry.severity === "blocker" || entry.severity === "major",
			)
		: [];
	if (openBlockers.length > 0 && malformed === undefined) {
		const first = openBlockers[0];
		const location =
			first?.path === undefined
				? {}
				: {
						path: first.path,
						...(first.line === undefined ? {} : { line: first.line }),
					};
		findings.push({
			ruleId: "core/review-gate",
			...location,
			message: `${String(openBlockers.length)} open blocker/major findings; only a code change starts a new round`,
			remediation:
				"Fix the blocker or major finding with a code change, then submit a new round.",
		});
	}
	if (
		detail.tree !== undefined &&
		file.tree !== undefined &&
		detail.tree !== file.tree
	) {
		findings.push({
			ruleId: "core/review-gate",
			message:
				"stale review: the index tree changed after the round was submitted",
			remediation: "Submit a new review round against the current staged tree.",
		});
	}
	const maxRounds = detail.maxRounds ?? 3;
	const completed = detail.completedRounds ?? 0;
	if (completed >= maxRounds) {
		findings.push({
			ruleId: "core/review-round-cap",
			message: `review round cap reached (${String(completed)} of ${String(maxRounds)}); escalation recorded`,
			remediation:
				"Stop and give a human the summary; run codictator task ack --note ... (human-only) to clear it.",
		});
	}
	void ctx;
	return findings;
}
