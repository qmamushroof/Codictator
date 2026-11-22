// SPEC §6.3 pack rules: python/typecheck and python/lint as the L1 static
// approximation: annotated literals of the wrong primitive type and
// never-read imports. The repo mypy/pyright and ruff runs stay bound
// through config.tools and the external contract in a later phase.
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
import { baseEnforcer } from "./health-measures.ts";
import { blankPythonCode, isPythonFile } from "./py-lex.ts";

const TYPE_MISMATCH =
	/:\s*(int|float|str|bool)\s*=\s*("[^"\n]*"|'[^'\n]*'|-?\b\d+\.\d+\b|-?\b\d+\b|\bTrue\b|\bFalse\b|\bNone\b)/;

// The primitive a Python literal denotes, as the L1 typecheck sees it.
export function pythonLiteralKind(literal: string): string {
	if (literal.startsWith('"') || literal.startsWith("'")) {
		return "str";
	}
	if (literal === "True" || literal === "False") {
		return "bool";
	}
	if (literal === "None") {
		return "none";
	}
	return literal.includes(".") ? "float" : "int";
}

// A `float` annotation accepts an `int` literal (promotion); otherwise the
// kinds must match exactly.
function isCleanAssignment(annotated: string, literalKind: string): boolean {
	return (
		(annotated === "float" && literalKind === "int") ||
		annotated === literalKind
	);
}

function typecheckLineFinding(
	binding: RuleBinding,
	file: string,
	line: number,
	content: string,
): Finding | null {
	const hit = TYPE_MISMATCH.exec(content);
	if (hit === null) {
		return null;
	}
	const annotated = hit[1] ?? "";
	const literal = hit[2] ?? "";
	if (isCleanAssignment(annotated, pythonLiteralKind(literal))) {
		return null;
	}
	return findingFor(binding, {
		path: file,
		line,
		message: `type error in ${file}:${String(line)}: ${annotated} assigned ${literal}`,
		vars: { path: file, line: String(line), value: literal },
	});
}

function typecheckTextFindings(
	binding: RuleBinding,
	file: string,
	text: string,
): Array<Finding> {
	const findings: Array<Finding> = [];
	let line = 0;
	for (const content of text.split("\n")) {
		line += 1;
		const finding = typecheckLineFinding(binding, file, line, content);
		if (finding !== null) {
			findings.push(finding);
		}
	}
	return findings;
}

// SPEC §6.3 python/typecheck as the L1 static approximation: an annotated
// literal of the wrong primitive type is a type error the checker would
// also reject. An `int` annotation holding a `float` literal stays clean
// (mypy accepts the promotion); a `float` holding an `int` literal is the
// narrowing the checker flags. The repo mypy/pyright run stays on the
// external contract.
export function resolvePythonTypecheck(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isPythonFile(file)) {
					continue;
				}
				const loaded = await readLossyText(ports.fs, file);
				if (!loaded.ok) {
					findings.push(readErrorFinding(binding, file, loaded.error, "read"));
					continue;
				}
				findings.push(
					...typecheckTextFindings(binding, file, loaded.value.text),
				);
			}
			return findings;
		}),
	);
}

const PY_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IMPORT_LINE = /^[ \t]*import[ \t]+(.+)$/;
const FROM_IMPORT_LINE =
	/^[ \t]*from[ \t]+(\.*)([A-Za-z_][A-Za-z0-9_.]*)?[ \t]+import[ \t]+(.+)$/;

// The name one `a as b` import part binds: the alias when present.
function importPartTarget(part: string): string {
	const alias = part.split(/\s+as\s+/);
	return (alias.length > 1 ? alias[1] : alias[0])?.trim() ?? "";
}

function bindName(bound: Map<string, number>, name: string, line: number) {
	if (PY_IDENTIFIER.test(name) && !bound.has(name)) {
		bound.set(name, line);
	}
}

function bindPlainImport(
	bound: Map<string, number>,
	list: string,
	line: number,
): void {
	for (const part of list.split(",")) {
		bindName(bound, importPartTarget(part).split(".", 1)[0] ?? "", line);
	}
}

function bindFromImport(
	bound: Map<string, number>,
	list: string,
	line: number,
): void {
	if (list.trim().startsWith("*")) {
		return;
	}
	for (const part of list.split(",")) {
		bindName(bound, importPartTarget(part).replace(/[()]/g, ""), line);
	}
}

// The names an import statement binds: `import a.b` binds `a`,
// `import a as b` binds `b`, `from m import x, y` binds `x` and `y`.
// A `from m import *` binds nothing observable, so it never flags.
function boundImportNames(text: string): Map<string, number> {
	const bound = new Map<string, number>();
	let line = 0;
	for (const content of blankPythonCode(text).split("\n")) {
		line += 1;
		const plain = IMPORT_LINE.exec(content);
		if (plain !== null) {
			bindPlainImport(bound, plain[1] ?? "", line);
			continue;
		}
		const from = FROM_IMPORT_LINE.exec(content);
		if (from !== null) {
			bindFromImport(bound, from[3] ?? "", line);
		}
	}
	return bound;
}

// SPEC §6.3 python/lint as the L1 static approximation: never-read imports
// (ruff F401). The repo ruff check and format --check runs stay on the
// external contract. Quoted forward references do not count as uses.
export function resolvePythonLint(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isPythonFile(file)) {
					continue;
				}
				const loaded = await readLossyText(ports.fs, file);
				if (!loaded.ok) {
					findings.push(readErrorFinding(binding, file, loaded.error, "read"));
					continue;
				}
				const blanked = blankPythonCode(loaded.value.text);
				for (const [name, atLine] of boundImportNames(loaded.value.text)) {
					const word = new RegExp(`\\b${name}\\b`, "g");
					const uses = blanked.match(word) ?? [];
					if (uses.length <= 1) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: atLine,
								message: `unused import ${name} in ${file}:${String(atLine)}`,
								vars: { path: file, line: String(atLine), value: name },
							}),
						);
					}
				}
			}
			return findings;
		}),
	);
}
