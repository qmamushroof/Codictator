// SPEC §5.12 F13/F14 plus §4.15.2 CI gate checks, and the §5.11
// conventional-commit subject check (decl module ci): fixture-shaped marker
// evaluators for the CI enforcers. Each reads the self-test marker report
// (§4.4.1 sample.txt files) and answers whether the rule fires, so the
// pack self-test (§4.4.4) drives them while the live reads (branch
// protection, workflow files) stay in their owning modules (§3.3 forbids
// packs from importing them). The required-check marker names the required
// set per SPEC §4.15.2; an unreadable report has no marker shape, so a
// missing list blocks (verify not reported required) while EC-1/EC-6 advise
// stays with the live ci read.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import { SUBJECT_PATTERN } from "../../records/commit-subject.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor } from "./binding.ts";
import {
	baseEnforcer,
	isMarkerFile,
	parseMarkers,
	scopeMarkerTexts,
} from "./health-measures.ts";
import { effectiveTextRule } from "./marker-scan.ts";
import { scopeMarkerRule, scopeTextRule } from "./scope-text-rule.ts";

// SPEC §4.15.2 core/ci-present: no committed workflow flags; a named one
// stays quiet.
export function resolveCiPresent(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeMarkerRule(
		decl,
		rule,
		ports,
		(binding, file, markers, findings) => {
			const workflow = markers.get("workflow") ?? "";
			if (workflow === "" || workflow === "missing") {
				findings.push(
					findingFor(binding, {
						path: file,
						message: "no CI workflow committed",
						vars: { path: file, detail: "the CI workflow" },
					}),
				);
			}
		},
	);
}

// SPEC §4.15.2 core/ci-actions-pinned: every uses: in every workflow is a
// 40-hex SHA (EC-5). A ref without @, or with anything but a full SHA,
// flags; local `./` actions, `docker://` images and containers stay with the
// ci module's read. A fixture marker report and a real workflow file
// (`.github/workflows/*.yml|yaml`) are judged alike, at L1 on the text the
// call carries.
const USES_LINE = /^[ \t]*(?:-[ \t]+)?uses[ \t]*:[ \t]*["']?([^\s"'#]+)/i;

function isWorkflowFile(file: string): boolean {
	return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file);
}

function unpinnedUses(text: string): Array<string> {
	const found: Array<string> = [];
	for (const line of text.split("\n")) {
		const uses = USES_LINE.exec(line)?.[1];
		if (
			uses === undefined ||
			uses.startsWith("./") ||
			uses.startsWith("docker://")
		) {
			continue;
		}
		const at = uses.indexOf("@");
		const ref = at >= 0 ? uses.slice(at + 1) : "";
		if (!/^[0-9a-f]{40}$/.test(ref)) {
			found.push(uses);
		}
	}
	return found;
}

export function resolveCiActionsPinned(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return effectiveTextRule(
		decl,
		rule,
		ports,
		"lines",
		(binding, file, text, findings) => {
			if (!isMarkerFile(file) && !isWorkflowFile(file)) {
				return;
			}
			for (const uses of unpinnedUses(text)) {
				findings.push(
					findingFor(binding, {
						path: file,
						message: `${uses} pins no full commit SHA`,
						vars: { path: file, value: uses },
					}),
				);
			}
		},
	);
}

// SPEC §4.15.2 core/branch-protection: a direct push to the default branch
// flags; a push via PR with checks stays quiet. The live force-push,
// deletion and squash reads stay in ci/evaluateProtection; the marker
// mirror answers the same question from the case report.
export function resolveBranchProtection(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				if ((markers.get("direct") ?? "") === "true") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "direct push to the default branch bypasses review",
							vars: { path: file, detail: markers.get("push") ?? "main" },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.15.2 + EC-7 core/ci-required-check: the default branch must
// require the verify check; a required set without it blocks. Mirrors the
// live ci/evaluateProtection block; a missing list also blocks (verify not
// reported required), while unreadable advise stays with the live read.
export function resolveCiRequiredCheck(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const required = (markers.get("required") ?? "")
					.split(",")
					.map((entry) => entry.trim().toLowerCase())
					.filter((entry) => entry !== "");
				if (!required.includes("verify")) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "the verify check is not a required check",
							vars: { path: file, detail: "verify" },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.11 core/conventional-commit: the subject matches the
// type(scope)!: detail form. A subject with no type prefix flags. The
// commit-msg hook judges the real message through checkCommitMessage
// (records/commit-subject.ts); this marker mirror judges the subject shape
// from the case report.
export function resolveConventionalCommit(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeTextRule(
		decl,
		rule,
		ports,
		(binding, file, text, findings) => {
			// Commit subjects arrive as marker reports (SPEC §4.4.1
			// sample.txt fixtures); source files carry `subject:` lines
			// of their own (parameters, YAML keys), which are not commits.
			if (!isMarkerFile(file)) {
				return;
			}
			const subject = parseMarkers(text).get("subject") ?? "";
			if (subject === "" || SUBJECT_PATTERN.test(subject)) {
				return;
			}
			findings.push(
				findingFor(binding, {
					path: file,
					message: "commit subject does not match the conventional form",
					vars: { path: file, detail: subject },
				}),
			);
		},
		isMarkerFile,
	);
}
