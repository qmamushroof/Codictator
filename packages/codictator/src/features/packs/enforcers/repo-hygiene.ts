// SPEC §5.11 F12 repo hygiene, split from the repo-integrity guards
// (integrity-guards-repo) by responsibility.
import {
	isFixturePath,
	type Ports,
	type Result,
} from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { findingFor, type RuleBinding } from "./binding.ts";
import { isMarkerFile } from "./health-markers.ts";
import { loadScopeText, parseMarkers } from "./health-measures.ts";
import { forEachMarkerText, markerRealGuard } from "./marker-scan.ts";

// SPEC §5.11 core/repo-hygiene: committed build output or caches flag, and
// a .gitattributes that does not set `* text=auto eol=lf` flags. A fixture
// marker report names its committed paths; the real staged paths are judged
// alike, matched on whole segments so src/dist-info stays quiet. The pack
// has no way to mark a directory as source (SPEC §5.11), so test trees and
// the guardrail launcher under .codictator/ count as source, never output.
// The root-file allowlist of §5.11 is not enumerated by SPEC and stays
// unjudged.
const OUTPUT_DIR_PATTERN =
	/(^|\/)(node_modules|dist|build|bin|obj|__pycache__|\.venv|coverage)(\/|$)/i;
const SOURCE_TREE_PATTERN = /^(\.codictator\/|(.*\/)?(tests?|__tests__)\/)/;
const LF_ATTRIBUTES = /^\*\s+(?=.*\btext=auto\b)(?=.*\beol=lf\b)/m;

function hygieneFinding(
	binding: RuleBinding,
	path: string,
	message: string,
): Finding {
	return findingFor(binding, { path, message, vars: { path } });
}

function outputFinding(binding: RuleBinding, path: string): Finding {
	return hygieneFinding(
		binding,
		path,
		`committed build output or cache: ${path}`,
	);
}

export function resolveRepoHygiene(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			forEachMarkerText(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				(_file, text) => {
					const bad = (parseMarkers(text).get("committed") ?? "")
						.split(",")
						.map((entry) => entry.trim())
						.find((entry) => OUTPUT_DIR_PATTERN.test(entry));
					if (bad !== undefined) {
						args.findings.push(outputFinding(args.binding, bad));
					}
				},
			),
		async (args) => {
			for (const file of args.files.filter((name) => !isMarkerFile(name))) {
				if (isFixturePath(file) || SOURCE_TREE_PATTERN.test(file)) {
					continue;
				}
				if (OUTPUT_DIR_PATTERN.test(file)) {
					args.findings.push(outputFinding(args.binding, file));
				} else if (file === ".gitattributes") {
					const text = await loadScopeText(
						args.ports,
						args.binding,
						file,
						args.findings,
					);
					if (text !== undefined && !LF_ATTRIBUTES.test(text)) {
						args.findings.push(
							hygieneFinding(
								args.binding,
								file,
								`${file} does not set text=auto eol=lf`,
							),
						);
					}
				}
			}
		},
	);
}
