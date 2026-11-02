// SPEC §4.2.2: shared validation primitives for config.json. Every check
// throws the CdxError its SPEC row owns; the CLI maps codes to exit codes.

import type { CdxError } from "../../kernel/index.ts";
import { makeError } from "../../kernel/index.ts";

// SPEC §7.2 and schema/config.schema.json: the only accepted top-level keys.
export const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set([
	"version",
	"codictator",
	"packs",
	"harnesses",
	"tunables",
	"architecture",
	"workflow",
	"spec",
	"testing",
	"commands",
	"steering",
	"tools",
	"security",
	"deps",
	"network",
	"integrity",
	"ci",
	"llm",
]);

// SPEC §7.2: adapter ids, plus custom: names.
export const KNOWN_HARNESSES: ReadonlySet<string> = new Set([
	"muse-code",
	"universal",
	"claude-code",
	"copilot",
	"codex-cli",
	"cursor",
	"gemini-cli",
	"opencode",
]);

// SPEC §4.11.1: the architecture profiles.
export const KNOWN_PROFILES: ReadonlySet<string> = new Set([
	"app",
	"library",
	"cli",
	"service",
]);

// SPEC §4.12.2: the seven mandatory phases in order.
export const MANDATORY_PHASES: ReadonlyArray<string> = [
	"discovery",
	"planning",
	"implementation",
	"validation",
	"review",
	"record",
	"integrate",
];

export function fail(
	code: string,
	message: string,
	remediation: string,
	detail?: string,
): never {
	const error: CdxError =
		detail === undefined
			? makeError(code, message, remediation)
			: makeError(code, message, remediation, detail);
	throw error;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (kernel schema.ts pattern).
export function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

export function e101Invalid(path: string, expected: string): never {
	fail(
		"CDX-E101",
		`value at ${path} is invalid: expected ${expected}`,
		"Fix the value so it matches schema/config.schema.json, then retry.",
	);
}
