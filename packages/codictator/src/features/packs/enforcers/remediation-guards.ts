// SPEC §5.6 core/remediation-step-size: a step stays within maxFiles files
// and maxChangedLines changed lines. The fixture measure report carries the
// counts; a report inside both budgets stays quiet (SPEC §4.4.4). The check
// mirrors features/deps/step-size.ts locally because §3.3 forbids the packs
// module from importing it.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	isMarkerFile,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.6 defaults: 10 files, 300 lines.
export function resolveRemediationStepSize(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const maxFiles = limitOf(binding, "maxFiles", 10);
	const maxChangedLines = limitOf(binding, "maxChangedLines", 300);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const markers = parseMarkers(text);
				const files = parseMarkerInt(markers, "files");
				const lines = parseMarkerInt(markers, "changed-lines");
				if (files !== undefined && files > maxFiles) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `remediation step touches ${String(files)} files, above the ${String(maxFiles)} file budget`,
							vars: {
								path: file,
								limit: `${String(maxFiles)}/${String(maxChangedLines)}`,
							},
						}),
					);
				}
				if (lines !== undefined && lines > maxChangedLines) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `remediation step touches ${String(lines)} lines, above the ${String(maxChangedLines)} line budget`,
							vars: {
								path: file,
								limit: `${String(maxFiles)}/${String(maxChangedLines)}`,
							},
						}),
					);
				}
			}
			return findings;
		}),
	);
}
