// SPEC §8.1: the error-code table behind `codictator explain CDX-Ennn`,
// first half (CDX-E001 through CDX-E306: bootstrap, config, packs and
// adapters). ErrorRow and the row helper live here so
// explain-table-tail.ts reuses them; explain.ts combines both halves in
// SPEC §8.1 order. Codes are append-only (SPEC §1.4): a new code is added
// in order, never by editing an existing row.

export interface ErrorRow {
	readonly code: string;
	readonly exit: number;
	readonly meaning: string;
	readonly remediation: string;
}

export function row(
	code: string,
	exit: number,
	meaning: string,
	remediation: string,
): ErrorRow {
	return { code, exit, meaning, remediation };
}

// SPEC §8.1: rows CDX-E001 through CDX-E306.
export const ERROR_ROWS_HEAD: ReadonlyArray<ErrorRow> = [
	row(
		"CDX-E001",
		6,
		"Node.js is not on PATH",
		"Install Node.js LTS and retry with node on PATH.",
	),
	row(
		"CDX-E002",
		6,
		"Node.js is older than the engine's engines.node",
		"Upgrade Node.js to the required version, then retry.",
	),
	row(
		"CDX-E003",
		6,
		"Engine not installed at the root or tool dir",
		"Run npm ci at the root or npm ci --prefix .codictator/tool, then retry.",
	),
	row(
		"CDX-E010",
		2,
		"Unknown rule, event or error id for explain",
		"Check the spelling; the nearest known ids are listed above.",
	),
	row(
		"CDX-E011",
		6,
		"Replay needs a pack version that is not installed",
		"Install the pack version the event records, then rerun codictator replay <eventId>.",
	),
	row(
		"CDX-E101",
		3,
		"Config missing, unparseable or schema-invalid",
		"Fix .codictator/config.json to match schema/config.schema.json, then retry.",
	),
	row(
		"CDX-E102",
		3,
		"config.codictator does not match the installed engine",
		"Set codictator to the installed engine version, or upgrade the engine.",
	),
	row(
		"CDX-E103",
		3,
		"Override or waiver of a floor rule",
		"Remove the override or waiver; floor rules cannot be loosened.",
	),
	row(
		"CDX-E104",
		3,
		"Tunable looser than its default outside a waiver",
		"Tighten the tunable, or move the loosening into .codictator/waivers.json.",
	),
	row(
		"CDX-E105",
		3,
		"Mandatory workflow gate removed or reordered, or an architecture change that loosens a profile rule or creates a cycle",
		"Restore the mandatory order and the profile rule, then retry.",
	),
	row(
		"CDX-E106",
		3,
		"Literal secret in config, or key over plaintext HTTP",
		"Remove the literal secret and use HTTPS, then retry.",
	),
	row(
		"CDX-E107",
		4,
		"Human-only command without a TTY or with agent markers",
		"Run this command yourself in an interactive terminal, not through an agent or hook.",
	),
	row(
		"CDX-E108",
		3,
		"Not a Codictator repo",
		"Run codictator init inside a repository, or change into a Codictator repo.",
	),
	row(
		"CDX-E109",
		3,
		"Waiver value beyond the pack bound",
		"Bring the waiver value inside the pack bound, then retry.",
	),
	row(
		"CDX-E110",
		3,
		"Waiver expiry beyond maxWaiverDays or renewal chain too long",
		"Shorten the expiry within maxWaiverDays and keep the chain short, then retry.",
	),
	row(
		"CDX-E201",
		7,
		"Schema uses an unsupported keyword",
		"Rewrite the schema with the supported 2020-12 subset, then retry.",
	),
	row(
		"CDX-E202",
		3,
		"Duplicate rule id",
		"Rename one of the rules so every rule id is unique, then retry.",
	),
	row(
		"CDX-E203",
		3,
		"Configured pack missing or failing self-test",
		"Install the pack at its pinned version and make codictator pack test pass, then retry.",
	),
	row(
		"CDX-E204",
		3,
		"Custom pack id or rule id collides with or impersonates a built-in",
		"Rename the custom pack and rules with a custom prefix, then retry.",
	),
	row(
		"CDX-E205",
		3,
		"Rule names an unknown enforcer",
		"Name a known enforcer for the rule's family, then retry.",
	),
	row(
		"CDX-E206",
		3,
		"Tool without an exact version pin",
		"Pin the tool to an exact version in config, then retry.",
	),
	row(
		"CDX-E207",
		1,
		"External tool error, unknown exit code, unparseable or oversized output, or path outside the repo",
		"Fix the tool invocation per the reported detail; the finding blocks until the run is clean.",
	),
	row(
		"CDX-E208",
		1,
		"External tool version does not match its pin",
		"Install the pinned tool version, then retry.",
	),
	row(
		"CDX-E209",
		1,
		"External tool not found",
		"Install the tool the pack needs, then retry.",
	),
	row(
		"CDX-E210",
		3,
		"External tool mapped to a rule outside its pack",
		"Map the tool to a rule inside its own pack, then retry.",
	),
	row(
		"CDX-E211",
		3,
		"Pack self-test failure (SPEC §4.4.4): rule fixtures",
		"Run codictator pack test <id> and fix the failing case, then retry.",
	),
	row(
		"CDX-E212",
		3,
		"Pack self-test failure (SPEC §4.4.4): enforcer binding",
		"Run codictator pack test <id> and fix the failing case, then retry.",
	),
	row(
		"CDX-E213",
		3,
		"Pack self-test failure (SPEC §4.4.4): parameter bounds",
		"Run codictator pack test <id> and fix the failing case, then retry.",
	),
	row(
		"CDX-E214",
		3,
		"Pack self-test failure (SPEC §4.4.4): default direction",
		"Run codictator pack test <id> and fix the failing case, then retry.",
	),
	row(
		"CDX-E215",
		3,
		"Pack self-test failure (SPEC §4.4.4): external tool declaration",
		"Run codictator pack test <id> and fix the failing case, then retry.",
	),
	row(
		"CDX-E216",
		3,
		"Pack self-test failure (SPEC §4.4.4): capability coverage",
		"Run codictator pack test <id> and fix the failing case, then retry.",
	),
	row(
		"CDX-E301",
		3,
		"Unknown or uninstalled harness id",
		"Use an installed adapter id, or add the custom adapter under .codictator/adapters/.",
	),
	row(
		"CDX-E302",
		3,
		"Custom adapter without passing contract tests",
		"Make the adapter pass its contract tests, then retry.",
	),
	row(
		"CDX-E303",
		1,
		"Hook payload unparseable or missing required fields",
		"Resend a well-formed hook payload; the finding blocks until it parses.",
	),
	row(
		"CDX-E305",
		1,
		"Hook payload over 8 MiB",
		"Write the file in smaller edits, then retry the tool call.",
	),
	row(
		"CDX-E306",
		1,
		"Shell command unparseable",
		"Simplify the shell command so it parses, then retry.",
	),
];
