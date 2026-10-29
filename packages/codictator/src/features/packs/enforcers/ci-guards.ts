// SPEC §5.12 F13/F14 plus §4.15.2 CI gate checks: fixture-shaped marker
// evaluators for the CI enforcers. Each reads the self-test marker report
// (§4.4.1 sample.txt files) and answers whether the rule fires, so the
// pack self-test (§4.4.4) drives them while the live reads (branch
// protection, workflow files) stay in their owning modules (§3.3 forbids
// packs from importing them). core/ci-required-check stays deferred: its
// marker table names lint/typecheck/test while SPEC §4.15.2 requires the
// verify check, so wiring it would settle a SPEC contradiction in code.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	isMarkerFile,
	loadScopeText,
	scopeMarkerTexts,
} from "./health-measures.ts";

// SPEC §4.15.2 core/ci-present: no committed workflow flags; a named one
// stays quiet.
export function resolveCiPresent(
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
			}
			return findings;
		}),
	);
}

// SPEC §4.15.2 core/ci-actions-pinned: every uses: in every workflow is a
// 40-hex SHA (EC-5). A ref without @, or with anything but a full SHA,
// flags; containers and images stay with the ci module's read.
export function resolveCiActionsPinned(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				for (const line of text.split("\n")) {
					const colon = line.indexOf(":");
					if (colon < 0) {
						continue;
					}
					if (line.slice(0, colon).trim().toLowerCase() !== "uses") {
						continue;
					}
					const uses = line.slice(colon + 1).trim();
					const at = uses.indexOf("@");
					const ref = at >= 0 ? uses.slice(at + 1) : "";
					if (/^[0-9a-f]{40}$/.test(ref) !== true) {
						findings.push(
							findingFor(binding, {
								path: file,
								message: `${uses} pins no full commit SHA`,
								vars: { path: file, value: uses },
							}),
						);
					}
				}
			}
			return findings;
		}),
	);
}
