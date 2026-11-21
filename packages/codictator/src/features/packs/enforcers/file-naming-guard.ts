// SPEC §5.11 + §6.1 core/file-naming: source file names are kebab-case,
// tests `*.test.<ext>`, framework-reserved names allowed. Fixture marker
// reports (`sample.txt`, §4.4.1) answer first; a real path then judges by
// its own name, at L1 the call's target and at L3/L4 each scope file. Only
// the §6.1 source extensions are judged, so other languages and prose files
// keep their own conventions.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { type bindRule, findingFor } from "./binding.ts";
import { isMarkerFile } from "./health-measures.ts";
import { effectiveFiles } from "./pre-tool-files.ts";
import { scopeMarkerRule } from "./scope-text-rule.ts";

const JUDGED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"] as const;
const QUALIFIERS = [".test", ".spec", ".config", ".d"] as const;

function isKebabStem(stem: string): boolean {
	return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
}

function judgedStem(base: string): string {
	const testAt = base.toLowerCase().indexOf(".test.");
	if (testAt >= 0) {
		return base.slice(0, testAt);
	}
	const dot = base.lastIndexOf(".");
	let stem = dot < 0 ? base : base.slice(0, dot);
	for (const qualifier of QUALIFIERS) {
		if (stem.endsWith(qualifier)) {
			stem = stem.slice(0, -qualifier.length);
		}
	}
	return stem;
}

function frameworkReserved(base: string): boolean {
	return base.startsWith("[") || base.startsWith("+") || base.startsWith("_");
}

function nameFinding(
	binding: ReturnType<typeof bindRule>,
	file: string,
	name: string,
): Finding | undefined {
	const base = name.split("/").pop() ?? name;
	if (frameworkReserved(base)) {
		return undefined;
	}
	const stem = judgedStem(base);
	if (isKebabStem(stem)) {
		return undefined;
	}
	return findingFor(binding, {
		path: file,
		message: `file stem "${stem}" is not kebab-case`,
		vars: { path: file },
	});
}

export function resolveFileNaming(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeMarkerRule(
		decl,
		rule,
		ports,
		(binding, file, markers, findings) => {
			const name = markers.get("file") ?? "";
			const found = name === "" ? undefined : nameFinding(binding, file, name);
			if (found !== undefined) {
				findings.push(found);
			}
		},
		(ctx, binding, findings) => judgeRealPaths(ctx, binding, findings),
	);
}

function judgeRealPaths(
	ctx: CheckContext,
	binding: ReturnType<typeof bindRule>,
	findings: Array<Finding>,
): void {
	for (const { path } of effectiveFiles(ctx, binding.scopeGlobs)) {
		if (
			isMarkerFile(path) ||
			!JUDGED_EXTENSIONS.some((extension) =>
				path.toLowerCase().endsWith(extension),
			)
		) {
			continue;
		}
		const found = nameFinding(binding, path, path);
		if (found !== undefined) {
			findings.push(found);
		}
	}
}
