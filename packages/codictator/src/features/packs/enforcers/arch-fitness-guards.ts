// SPEC §5.7 F7 fitness and compiler enforcers (decl module arch): the module
// size limit and the strict-compiler flag, each honouring the fixture
// measure report first. Split from arch-guards.ts, which re-exports them so
// rule ids keep working.
import type { Ports } from "../../../kernel/index.ts";
import { parseJson, type Result } from "../../../kernel/index.ts";
import type { Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import { type EnforcerDecl, isRecord } from "../manifest.ts";
import { findingFor } from "./binding.ts";
import { isMarkerFile } from "./health-markers.ts";
import { limitOf, parseMarkerInt, parseMarkers } from "./health-measures.ts";
import { scopeTextRule } from "./scope-text-rule.ts";

// SPEC §5.7 core/arch-module-size: a module over its file or line limit
// flags.
export function resolveArchModuleSize(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeTextRule(
		decl,
		rule,
		ports,
		(binding, file, text, findings) => {
			const maxFiles = limitOf(binding, "maxFiles", 80);
			const maxLines = limitOf(binding, "maxLines", 8000);
			const markers = parseMarkers(text);
			const files = parseMarkerInt(markers, "files");
			const lines = parseMarkerInt(markers, "lines");
			if (
				(files !== undefined && files > maxFiles) ||
				(lines !== undefined && lines > maxLines)
			) {
				findings.push(
					findingFor(binding, {
						path: file,
						message: `module over its size limit in ${file}`,
						vars: {
							path: file,
							limit: `${String(maxFiles)}/${String(maxLines)}`,
						},
					}),
				);
			}
		},
		isMarkerFile,
	);
}

// SPEC §5.7 core/compiler-strict: a tsconfig without strict mode flags.
//
// TsconfigShape narrows the generic JSON value at the parse boundary so
// the reads below use declared properties: an un-narrowed
// Record<string, unknown> only allows bracket access, which the linter
// rejects in favour of literal keys.
type TsconfigShape = {
	compilerOptions?: { strict?: unknown };
};

function isTsconfigShape(value: unknown): value is TsconfigShape {
	if (!isRecord(value)) {
		return false;
	}
	const { compilerOptions } = value;
	return compilerOptions === undefined || isRecord(compilerOptions);
}

function isStrictTsconfig(text: string): boolean {
	const parsed = parseJson(text);
	if (!parsed.ok || !isTsconfigShape(parsed.value)) {
		return false;
	}
	return parsed.value.compilerOptions?.strict === true;
}

export function resolveCompilerStrict(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return scopeTextRule(
		decl,
		rule,
		ports,
		(binding, file, text, findings) => {
			if (!isStrictTsconfig(text)) {
				findings.push(
					findingFor(binding, {
						path: file,
						message: `strict mode off in ${file}`,
						vars: { path: file },
					}),
				);
			}
		},
		(file) => file.endsWith("tsconfig.json"),
	);
}
