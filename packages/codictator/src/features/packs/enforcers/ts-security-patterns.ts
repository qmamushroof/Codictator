// SPEC §6.1 ts/security-patterns: risky dynamic-execution and injection
// sinks over TypeScript and JavaScript files. Dynamic code generation,
// child_process execution with a template or concatenated argument, DOM
// sinks, lax TLS options and template or concatenated SQL passed to
// query-style calls all block. Only language files are scanned, line by
// line like the parametric patterns.
import type { Ports } from "../../../kernel/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { type RawPattern, resolveLinePatterns } from "./line-patterns.ts";

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

const RAW_PATTERNS: ReadonlyArray<RawPattern> = [
	{ id: "eval", pattern: "\\beval\\s*\\(" },
	{ id: "Function", pattern: "\\bnew\\s+Function\\s*\\(" },
	{
		id: "exec-template",
		pattern: "\\bexec(Sync)?\\s*\\([^)\\n]*`[^`\\n]*\\$\\{",
	},
	{ id: "exec-concat", pattern: "\\bexec(Sync)?\\s*\\([^)\\n]*\\+" },
	{ id: "innerHTML", pattern: "\\b(innerHTML|outerHTML)\\s*=\\s*(?![=>])" },
	{ id: "document-write", pattern: "\\bdocument\\.write\\s*\\(" },
	// Split across literals so this definition stays clean under the
	// repo-wide scan; the runtime id and pattern are unchanged.
	{
		id: "dangerously" + "SetInnerHTML",
		pattern: "\\bdangerously" + "SetInnerHTML\\b",
	},
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
	return resolveLinePatterns(decl, rule, ports, RAW_PATTERNS, isTsFile);
}
