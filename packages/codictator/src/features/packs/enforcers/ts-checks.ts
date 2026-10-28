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
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import { baseEnforcer, isTsFile } from "./health-measures.ts";

// SPEC §6.1 ts/typecheck as the L1 static approximation: an annotated
// literal of the wrong primitive type is a type error the compiler would
// also reject. The repo tsc --noEmit run stays on the external contract.
export function resolveTsTypecheck(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const mismatch =
		/:\s*(number|string|boolean)\s*=\s*("[^"\n]*"|'[^'\n]*'|`[^`\n]*`|-?\b\d+(\.\d+)?\b|\btrue\b|\bfalse\b)/;
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
						literal.startsWith('"') ||
						literal.startsWith("'") ||
						literal.startsWith("`")
							? "string"
							: literal === "true" || literal === "false"
								? "boolean"
								: "number";
					if (annotated !== literalKind) {
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

// SPEC §6.1 ts/lint as the L1 static approximation: `var` bindings and
// never-read `let`/`const` bindings. The repo linter run stays on the
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
				const blanked = blankCode(loaded.value.text);
				const lines = blanked.split("\n");
				const declared = new Map<string, number>();
				for (let line = 0; line < lines.length; line += 1) {
					const content = lines[line] ?? "";
					const varHit = /\bvar\s+([A-Za-z_$][\w$]*)/.exec(content);
					if (varHit !== null) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: line + 1,
								message: `var binding ${varHit[1] ?? ""} in ${file}:${String(line + 1)}`,
								vars: { path: file, line: String(line + 1) },
							}),
						);
					}
					const constHit = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(
						content,
					);
					if (constHit !== null && (constHit[1] ?? "") !== "") {
						declared.set(constHit[1] ?? "", line + 1);
					}
				}
				for (const [name, atLine] of declared) {
					const word = new RegExp(`\\b${name}\\b`, "g");
					const uses = blanked.match(word) ?? [];
					if (uses.length <= 1) {
						findings.push(
							findingFor(binding, {
								path: file,
								line: atLine,
								message: `unused binding ${name} in ${file}:${String(atLine)}`,
								vars: { path: file, line: String(atLine) },
							}),
						);
					}
				}
			}
			return findings;
		}),
	);
}
