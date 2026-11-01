// SPEC §6.3 python/security-patterns: dangerous Python patterns over
// source files. Dynamic evaluation sinks, shell-spawning subprocess calls,
// unsafe deserialization and loading calls, and disabled TLS verification
// all block. Only language files are scanned, line by line like the
// parametric patterns.
import { checkPattern, type Ports } from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
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
import { isPythonFile } from "./py-lex.ts";

const RAW_PATTERNS: ReadonlyArray<{
	readonly id: string;
	readonly pattern: string;
}> = [
	{ id: "eval", pattern: "\\beval\\s*\\(" },
	{ id: "exec", pattern: "\\bexec\\s*\\(" },
	{ id: "shell-true", pattern: "\\bshell\\s*=\\s*True\\b" },
	{ id: "pickle-loads", pattern: "\\bpickle\\s*\\.\\s*loads\\s*\\(" },
	{ id: "yaml-load", pattern: "\\byaml\\s*\\.\\s*load\\s*\\(" },
	{ id: "verify-false", pattern: "\\bverify\\s*=\\s*False\\b" },
];

export function resolvePythonSecurityPatterns(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) {
	const binding: RuleBinding = bindRule(rule);
	const compiled: Array<{ readonly id: string; readonly pattern: RegExp }> = [];
	for (const entry of RAW_PATTERNS) {
		const safe = checkPattern(entry.pattern);
		if (!safe.ok) {
			return { ok: false as const, error: safe.error };
		}
		compiled.push({ id: entry.id, pattern: new RegExp(entry.pattern) });
	}
	return {
		ok: true as const,
		value: {
			id: rule.id,
			kinds: binding.triggers,
			budgetMs: decl.budgetMs,
			check: async (ctx: CheckContext): Promise<Array<Finding>> => {
				const findings: Array<Finding> = [];
				for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
					if (!isPythonFile(file)) {
						continue;
					}
					const loaded = await readLossyText(ports.fs, file);
					if (!loaded.ok) {
						findings.push(
							readErrorFinding(binding, file, loaded.error, "read"),
						);
						continue;
					}
					let line = 0;
					for (const content of loaded.value.text.split("\n")) {
						line += 1;
						for (const entry of compiled) {
							if (!entry.pattern.test(content)) {
								continue;
							}
							// A SafeLoader riding the yaml.load call line is
							// the sanctioned sink; anything else blocks.
							if (entry.id === "yaml-load" && content.includes("SafeLoader")) {
								continue;
							}
							findings.push(
								findingFor(binding, {
									path: file,
									line,
									message: `dangerous pattern ${entry.id} in ${file}:${String(line)}`,
									vars: { path: file, line: String(line) },
								}),
							);
							break;
						}
					}
				}
				return findings;
			},
		},
	};
}
