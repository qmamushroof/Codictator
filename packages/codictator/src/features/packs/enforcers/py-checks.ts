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
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { baseEnforcer } from "./health-measures.ts";
import { blankPythonCode, isPythonFile } from "./py-lex.ts";

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
	const mismatch =
		/:\s*(int|float|str|bool)\s*=\s*("[^"\n]*"|'[^'\n]*'|-?\b\d+\.\d+\b|-?\b\d+\b|\bTrue\b|\bFalse\b|\bNone\b)/;
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
				let line = 0;
				for (const content of loaded.value.text.split("\n")) {
					line += 1;
					const hit = mismatch.exec(content);
					if (hit === null) {
						continue;
					}
					const annotated = hit[1] ?? "";
					const literal = hit[2] ?? "";
					const literalKind =
						literal.startsWith('"') || literal.startsWith("'")
							? "str"
							: literal === "True" || literal === "False"
								? "bool"
								: literal === "None"
									? "none"
									: literal.includes(".")
										? "float"
										: "int";
					const clean =
						(annotated === "float" && literalKind === "int") ||
						annotated === literalKind;
					if (!clean) {
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
			}
			return findings;
		}),
	);
}

// The names an import statement binds: `import a.b` binds `a`,
// `import a as b` binds `b`, `from m import x, y` binds `x` and `y`.
// A `from m import *` binds nothing observable, so it never flags.
function boundImportNames(text: string): Map<string, number> {
	const blanked = blankPythonCode(text);
	const bound = new Map<string, number>();
	const importLine = /^[ \t]*import[ \t]+(.+)$/;
	const fromLine =
		/^[ \t]*from[ \t]+(\.*)([A-Za-z_][A-Za-z0-9_.]*)?[ \t]+import[ \t]+(.+)$/;
	let line = 0;
	for (const content of blanked.split("\n")) {
		line += 1;
		const plain = importLine.exec(content);
		if (plain !== null) {
			for (const part of (plain[1] ?? "").split(",")) {
				const alias = part.split(/\s+as\s+/);
				const dotted = (alias.length > 1 ? alias[1] : alias[0])?.trim() ?? "";
				const top = dotted.split(".", 1)[0] ?? "";
				if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(top) && !bound.has(top)) {
					bound.set(top, line);
				}
			}
			continue;
		}
		const from = fromLine.exec(content);
		if (from !== null) {
			if ((from[3] ?? "").trim().startsWith("*")) {
				continue;
			}
			for (const part of (from[3] ?? "").split(",")) {
				const alias = part.split(/\s+as\s+/);
				const name =
					(alias.length > 1 ? alias[1] : alias[0])
						?.trim()
						.replace(/[()]/g, "") ?? "";
				if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !bound.has(name)) {
					bound.set(name, line);
				}
			}
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
