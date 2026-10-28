// SPEC §5.6 core/dead-code: no unused exports or members. The pack
// measure is an exported name in a non-entry file with no importer.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import {
	baseEnforcer,
	exportedNamesOf,
	fileImportsTarget,
	isEntryFile,
	isMarkerFile,
	isTsFile,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.6 core/dead-code: no unused exports or members. The pack
// measure is an exported name in a non-entry file with no importer.
export function resolveDeadCode(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			const files = selectFiles(ctx.scope.files, binding.scopeGlobs);
			const texts = new Map<string, string>();
			for (const file of files) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text !== undefined) {
					texts.set(file, text);
				}
			}
			for (const file of files) {
				const text = texts.get(file);
				if (text === undefined) {
					continue;
				}
				if (isMarkerFile(file)) {
					const markers = parseMarkers(text);
					const importers = parseMarkerInt(markers, "importers") ?? 1;
					const exported = markers.get("exported") ?? "export";
					if (importers === 0) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: 1,
								message: `unused export ${exported} in ${file}`,
								vars: { path: file, line: "1", value: exported },
							}),
						);
					}
					continue;
				}
				if (!isTsFile(file) || isEntryFile(file)) {
					continue;
				}
				const exported = exportedNamesOf(blankCode(text));
				if (exported.length === 0) {
					continue;
				}
				const imported = [...texts.entries()].some(
					([other, otherText]) =>
						other !== file &&
						isTsFile(other) &&
						fileImportsTarget(otherText, file),
				);
				if (!imported) {
					for (const name of exported) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: 1,
								message: `unused export ${name} in ${file}`,
								vars: { path: file, line: "1", value: name },
							}),
						);
					}
				}
			}
			return findings;
		}),
	);
}
