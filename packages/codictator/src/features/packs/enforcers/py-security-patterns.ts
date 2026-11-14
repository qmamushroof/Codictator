// SPEC §6.3 python/security-patterns: dangerous Python patterns over
// source files. Dynamic evaluation sinks, shell-spawning subprocess calls,
// unsafe deserialization and loading calls, and disabled TLS verification
// all block. Only language files are scanned, line by line like the
// parametric patterns.
import type { Ports } from "../../../kernel/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	type LineExemption,
	type RawPattern,
	resolveLinePatterns,
} from "./line-patterns.ts";
import { isPythonFile } from "./py-lex.ts";

const RAW_PATTERNS: ReadonlyArray<RawPattern> = [
	{ id: "eval", pattern: "\\beval\\s*\\(" },
	{ id: "exec", pattern: "\\bexec\\s*\\(" },
	{ id: "shell-true", pattern: "\\bshell\\s*=\\s*True\\b" },
	{ id: "pickle-loads", pattern: "\\bpickle\\s*\\.\\s*loads\\s*\\(" },
	{ id: "yaml-load", pattern: "\\byaml\\s*\\.\\s*load\\s*\\(" },
	{ id: "verify-false", pattern: "\\bverify\\s*=\\s*False\\b" },
];

// A SafeLoader riding the yaml.load call line is the sanctioned sink;
// anything else blocks.
const sanctioned: LineExemption = (id, content) =>
	id === "yaml-load" && content.includes("SafeLoader");

export function resolvePythonSecurityPatterns(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) {
	return resolveLinePatterns(
		decl,
		rule,
		ports,
		RAW_PATTERNS,
		isPythonFile,
		sanctioned,
	);
}
