// SPEC §6.1 pack rules: ts/typecheck and ts/lint as the L1 static
// approximation: literal type mismatches and `var`/unused bindings. The
// full repo compiler and linter runs stay bound through config.tools and
// the external contract in a later phase.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import { baseEnforcer, isTsFile } from "./health-measures.ts";

// Quotes stay escapes inside the pattern so it also reads cleanly to text
// scans that do not lex regex literals.
const TYPE_LITERAL_MISMATCH =
	/:\s*(number|string|boolean)\s*=\s*(\x22[^\x22\n]*\x22|\x27[^\x27\n]*\x27|\x60[^\x60\n]*\x60|-?\b\d+(\.\d+)?\b|\btrue\b|\bfalse\b)/;

type LiteralKind = "string" | "boolean" | "number";

function literalKindOf(literal: string): LiteralKind {
	if (
		literal.startsWith('"') ||
		literal.startsWith("'") ||
		literal.startsWith("`")
	) {
		return "string";
	}
	if (literal === "true" || literal === "false") {
		return "boolean";
	}
	return "number";
}

function typecheckText(
	binding: RuleBinding,
	file: string,
	text: string,
): Array<Finding> {
	const findings: Array<Finding> = [];
	let line = 0;
	for (const content of text.split("\n")) {
		line += 1;
		const hit = TYPE_LITERAL_MISMATCH.exec(content);
		if (hit === null) {
			continue;
		}
		const annotated = hit[1] ?? "";
		const literal = hit[2] ?? "";
		if (annotated !== literalKindOf(literal)) {
			findings.push(
				findingFor(binding, {
					path: file,
					line,
					message: `type error in ${file}:${String(line)}: ${annotated} assigned ${literal}`,
					vars: { path: file, line: String(line), value: literal },
				}),
			);
		}
	}
	return findings;
}

// SPEC §6.1 ts/typecheck as the L1 static approximation: an annotated
// literal of the wrong primitive type is a type error the compiler would
// also reject. The repo tsc --noEmit run stays on the external contract.
export function resolveTsTypecheck(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isTsFile(file)) {
					continue;
				}
				const loaded = await readLossyText(ports.fs, file);
				if (!loaded.ok) {
					findings.push(readErrorFinding(binding, file, loaded.error, "read"));
					continue;
				}
				findings.push(...typecheckText(binding, file, loaded.value.text));
			}
			return findings;
		}),
	);
}

interface DeclaredBinding {
	readonly line: number;
	readonly exported: boolean;
}

function lintVarFinding(
	binding: RuleBinding,
	file: string,
	content: string,
	line: number,
): Finding | undefined {
	const varHit = /\bvar\s+([A-Za-z_$][\w$]*)/.exec(content);
	if (varHit === null) {
		return undefined;
	}
	return findingFor(binding, {
		path: file,
		line,
		message: `var binding ${varHit[1] ?? ""} in ${file}:${String(line)}`,
		vars: { path: file, line: String(line) },
	});
}

function lintConstEntry(
	content: string,
	line: number,
): { readonly name: string; readonly entry: DeclaredBinding } | undefined {
	// SPEC §6.4 EC-12: an exported binding is module public API;
	// its importers live outside this file, so the unused check
	// skips it and leaves unused exports to core/dead-code.
	const constHit =
		/\b(?:(export)\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(content);
	if (constHit === null || (constHit[2] ?? "") === "") {
		return undefined;
	}
	return {
		name: constHit[2] ?? "",
		entry: { line, exported: constHit[1] === "export" },
	};
}

function unusedBindingFindings(
	binding: RuleBinding,
	file: string,
	blanked: string,
	declared: ReadonlyMap<string, DeclaredBinding>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const [name, declaredAt] of declared) {
		if (declaredAt.exported) {
			continue;
		}
		const word = new RegExp(`\\b${name}\\b`, "g");
		const uses = blanked.match(word) ?? [];
		if (uses.length > 1) {
			continue;
		}
		findings.push(
			findingFor(binding, {
				path: file,
				line: declaredAt.line,
				message: `unused binding ${name} in ${file}:${String(declaredAt.line)}`,
				vars: { path: file, line: String(declaredAt.line) },
			}),
		);
	}
	return findings;
}

function lintText(
	binding: RuleBinding,
	file: string,
	text: string,
): Array<Finding> {
	const blanked = blankCode(text);
	const lines = blanked.split("\n");
	const findings: Array<Finding> = [];
	const declared = new Map<string, DeclaredBinding>();
	for (let line = 0; line < lines.length; line += 1) {
		const content = lines[line] ?? "";
		const varFinding = lintVarFinding(binding, file, content, line + 1);
		if (varFinding !== undefined) {
			findings.push(varFinding);
		}
		const constEntry = lintConstEntry(content, line + 1);
		if (constEntry !== undefined) {
			declared.set(constEntry.name, constEntry.entry);
		}
	}
	findings.push(...unusedBindingFindings(binding, file, blanked, declared));
	return findings;
}

// SPEC §6.1 ts/lint as the L1 static approximation: `var` bindings and
// never-read non-exported `let`/`const` bindings (exported names are public
// API judged by core/dead-code, §6.4 EC-12). The repo linter run stays on the
// external contract.
export function resolveTsLint(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isTsFile(file)) {
					continue;
				}
				const loaded = await readLossyText(ports.fs, file);
				if (!loaded.ok) {
					findings.push(readErrorFinding(binding, file, loaded.error, "read"));
					continue;
				}
				findings.push(...lintText(binding, file, loaded.value.text));
			}
			return findings;
		}),
	);
}
