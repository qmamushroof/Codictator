// SPEC §4.14.2/§4.14.3 + §5.11: repo-integrity enforcers. Split from the
// test-integrity guards (integrity-guards) by responsibility: hook bypass
// and committed hygiene here, test vectors there.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor } from "./binding.ts";
import { baseEnforcer, scopeMarkerTexts } from "./health-measures.ts";

// SPEC §4.14.2/§4.14.3 core/no-bypass: a commit that skips the hooks
// (--no-verify) flags at L4. The L1 command shapes live in
// integrity/matchCommand; the marker mirror answers from the case report.
export function resolveNoBypass(
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
				if ((markers.get("commit") ?? "").includes("--no-verify")) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "commit skips the hooks with --no-verify",
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.11 core/repo-hygiene: committed build output or caches flag. The
// .gitattributes and root-allowlist reads stay in the integrity module;
// the marker mirror judges only the reported committed paths, matched on
// whole segments so src/dist-info stays quiet.
const OUTPUT_DIR_PATTERN =
	/(^|\/)(node_modules|dist|build|bin|obj|__pycache__|\.venv|coverage)(\/|$)/i;

export function resolveRepoHygiene(
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
				const committed = (markers.get("committed") ?? "")
					.split(",")
					.map((entry) => entry.trim())
					.filter((entry) => entry !== "");
				const bad = committed.find((entry) => OUTPUT_DIR_PATTERN.test(entry));
				if (bad !== undefined) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `committed build output or cache: ${bad}`,
							vars: { path: bad },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
