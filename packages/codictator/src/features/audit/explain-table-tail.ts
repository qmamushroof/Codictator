// SPEC §8.1: the error-code table, second half (CDX-E401 through CDX-E903:
// registry, CI, workflow, filesystem, events, LLM and runtime). Combined
// with explain-table.ts by explain.ts; the append-only rule lives there.
import { type ErrorRow, row } from "./explain-table.ts";

// SPEC §8.1: rows CDX-E401 through CDX-E903.
export const ERROR_ROWS_TAIL: ReadonlyArray<ErrorRow> = [
	row(
		"CDX-E401",
		5,
		"Registry or advisory data unavailable and no usable snapshot",
		"Retry with network access, or record a usable registry snapshot first.",
	),
	row(
		"CDX-E501",
		1,
		"Managed block markers malformed or duplicated",
		"Restore the file with codictator regen; never hand-edit generated artifacts.",
	),
	row(
		"CDX-E503",
		5,
		"CI base commit unreachable (shallow clone)",
		"Fetch with fetch-depth 0 so the base is reachable, then rerun.",
	),
	row(
		"CDX-E601",
		1,
		"Red proof attempted after implementation began",
		"Write the failing red proof before implementing, then retry.",
	),
	row(
		"CDX-E602",
		1,
		"Declared test did not execute and fail",
		"Declare a test that executes and fails red, then retry.",
	),
	row(
		"CDX-E604",
		1,
		"Phase gate evidence missing",
		"Attach the phase gate evidence the step requires, then retry.",
	),
	row(
		"CDX-E605",
		1,
		"Reviewer session not fresh",
		"Have a fresh session that wrote no file of the task run the review, then retry.",
	),
	row(
		"CDX-E606",
		3,
		"More than one open task on a branch",
		"Close the extra open tasks so one branch holds one task, then retry.",
	),
	row(
		"CDX-E607",
		3,
		"Review findings file invalid",
		"Fix the review findings file to match its schema, then retry.",
	),
	row(
		"CDX-E608",
		1,
		"Remediation needs a clean work tree",
		"Commit or stash the work tree, then retry the remediation step.",
	),
	row(
		"CDX-E609",
		4,
		"Rollback refused outside Codictator's step branches",
		"Run the rollback on a Codictator step branch, with a human driving.",
	),
	row(
		"CDX-E701",
		1,
		"Write outside the repo root or temp dir",
		"Keep the path inside the repo root or the OS temp dir, then retry.",
	),
	row(
		"CDX-E702",
		5,
		"Network host not on the allowlist",
		"Use an allowlisted registry or advisory host, then retry.",
	),
	row(
		"CDX-E703",
		6,
		"git missing or not a git repository",
		"Run inside a git repository so paths resolve against its root.",
	),
	row(
		"CDX-E801",
		7,
		"Event log not writable (verdict blocked)",
		"Free disk space and fix permissions on .codictator/state/, then retry.",
	),
	row(
		"CDX-E851",
		3,
		"No LLM configured for --llm",
		"Configure config.llm or drop the --llm flag, then retry.",
	),
	row(
		"CDX-E852",
		5,
		"LLM key missing or rejected",
		"Set a valid LLM API key in the environment, then retry.",
	),
	row(
		"CDX-E853",
		1,
		"LLM draft invalid after repair",
		"Simplify the generation request and retry.",
	),
	row(
		"CDX-E854",
		5,
		"LLM unavailable (timeout, 429, 5xx after retries)",
		"Wait and retry; the provider is unreachable right now.",
	),
	row(
		"CDX-E901",
		7,
		"Enforcer or runtime threw",
		"Fix the throwing enforcer or runtime path; the failure stays fail-closed until then.",
	),
	row(
		"CDX-E902",
		1,
		"Budget or time limit exceeded",
		"Shrink the scope or raise the budget, then retry.",
	),
	row(
		"CDX-E903",
		5,
		"Required data or tool for an enforcer unavailable",
		"Provide the required data or tool, then retry.",
	),
];
