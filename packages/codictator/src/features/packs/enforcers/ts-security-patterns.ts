// SPEC §6.1 ts/security-patterns: dangerous JS patterns over TypeScript
// and JavaScript files. eval(, new Function(, child_process exec/execSync
// with a template or concatenated argument, innerHTML/outerHTML
// assignment, document.write(, dangerouslySetInnerHTML,
// rejectUnauthorized: false, NODE_TLS_REJECT_UNAUTHORIZED and template or
// concatenated SQL passed to .query(, .execute( or .raw( all block. Only
// language files are scanned, line by line like the parametric patterns.
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

const TS_EXTENSIONS: ReadonlyArray<string> = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
];

const RAW_PATTERNS: ReadonlyArray<{
	readonly id: string;
	readonly pattern: string;
}> = [
	{ id: "eval", pattern: "\\beval\\s*\\(" },
	{ id: "Function", pattern: "\\bnew\\s+Function\\s*\\(" },
	{
		id: "exec-template",
		pattern: "\\bexec(Sync)?\\s*\\([^)\\n]*`[^`\\n]*\\$\\{",
	},
	{ id: "exec-concat", pattern: "\\bexec(Sync)?\\s*\\([^)\\n]*\\+" },
	{ id: "innerHTML", pattern: "\\b(innerHTML|outerHTML)\\s*=\\s*(?![=>])" },
	{ id: "document-write", pattern: "\\bdocument\\.write\\s*\\(" },
	{ id: "dangerouslySetInnerHTML", pattern: "\\bdangerouslySetInnerHTML\\b" },
	{
		id: "rejectUnauthorized",
		pattern: "\\brejectUnauthorized\\s*:\\s*false\\b",
	},
	{ id: "tls-env", pattern: "\\bNODE_TLS_REJECT_UNAUTHORIZED\\b" },
	{
		id: "sql-template",
		pattern: "\\.(query|execute|raw)\\s*\\([^)\\n]*`[^`\\n]*\\$\\{",
	},
	{ id: "sql-concat", pattern: "\\.(query|execute|raw)\\s*\\([^)\\n]*\\+" },
];

function isTsFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return TS_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

export function resolveTsSecurityPatterns(
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
					if (!isTsFile(file)) {
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
							if (entry.pattern.test(content)) {
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
				}
				return findings;
			},
		},
	};
}
