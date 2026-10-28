// SPEC §4.4.5 declaration narrowing: config.tools rows (§7.2) and the
// pack enforcer's input/output/exit-code binding. Malformed bindings fail
// the load (CDX-E203, CDX-E206); the runner never sees them.
import {
	checkPattern,
	err,
	makeError,
	ok,
	type Result,
} from "../../../kernel/index.ts";
import { field, isRecord } from "../manifest.ts";
import {
	type ExternalArgs,
	type ExternalOutput,
	isExternalInput,
	type ToolDecl,
} from "./external.ts";

const DEFAULT_TIMEOUT_MS = 30000;

function toolError(code: string, detail: string): Result<never> {
	return err(
		makeError(
			code,
			detail,
			"Fix the external tool binding or the tool itself, then reload the pack.",
		),
	);
}

function stringList(value: unknown): Array<string> | undefined {
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string")
	) {
		return [...value];
	}
	return undefined;
}

// SPEC §7.2: a tools entry needs an id, an argv command and an exact pin
// with its probe. CDX-E206 when the pin is missing (§8).
export function narrowToolDecl(entry: unknown): Result<ToolDecl> {
	if (!isRecord(entry)) {
		return toolError("CDX-E203", "a config.tools entry must be an object");
	}
	const id: unknown = field(entry, "id");
	const command = stringList(field(entry, "command")) ?? [];
	if (typeof id !== "string" || id.length === 0 || command.length === 0) {
		return toolError(
			"CDX-E203",
			"a config.tools entry needs a non-empty id and command argv",
		);
	}
	const version: unknown = field(entry, "version");
	if (!isRecord(version)) {
		return toolError("CDX-E206", `tool "${id}" has no exact version pin`);
	}
	const pin: unknown = field(version, "pin");
	if (typeof pin !== "string" || pin.length === 0) {
		return toolError("CDX-E206", `tool "${id}" has no exact version pin`);
	}
	const probe = stringList(field(version, "probe")) ?? [];
	const pattern: unknown = field(version, "pattern");
	if (
		probe.length === 0 ||
		typeof pattern !== "string" ||
		pattern.length === 0
	) {
		return toolError(
			"CDX-E203",
			`tool "${id}" needs a probe argv and a pattern`,
		);
	}
	const role: unknown = field(entry, "role");
	if (typeof role === "string" && role !== "enforcer") {
		return toolError(
			"CDX-E203",
			`tool "${id}" is a helper and cannot back an enforcer`,
		);
	}
	const timeout: unknown = field(entry, "timeoutMs");
	const envPass = stringList(field(entry, "envPass")) ?? [];
	return ok({
		id,
		command,
		version: { pin, probe, pattern },
		role: typeof role === "string" ? role : undefined,
		timeoutMs:
			typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0
				? timeout
				: DEFAULT_TIMEOUT_MS,
		envPass,
	});
}

function narrowOutput(declId: string, value: unknown): Result<ExternalOutput> {
	if (!isRecord(value)) {
		return toolError(declId, "needs an output binding");
	}
	const withId = (detail: string): Result<never> =>
		toolError("CDX-E203", `pack enforcer "${declId}" ${detail}`);
	const format: unknown = field(value, "format");
	if (
		format !== "sarif" &&
		format !== "json" &&
		format !== "regex" &&
		format !== "exit-code"
	) {
		return withId("needs an output format of sarif, json, regex or exit-code");
	}
	const source: unknown = field(value, "source") ?? "stdout";
	if (source !== "stdout" && source !== "{out}") {
		return withId("needs an output source of stdout or {out}");
	}
	const output = source === "{out}" ? "{out}" : "stdout";
	if (format === "json") {
		return narrowJsonSelect(withId, format, output, field(value, "select"));
	}
	if (format === "regex") {
		return narrowRegexPattern(withId, format, output, field(value, "pattern"));
	}
	return ok({ format, source: output, select: undefined, pattern: undefined });
}

function narrowJsonSelect(
	withId: (detail: string) => Result<never>,
	format: "json",
	output: "stdout" | "{out}",
	select: unknown,
): Result<ExternalOutput> {
	if (!isRecord(select)) {
		return withId("needs a select for json output");
	}
	const names = ["results", "path", "line", "rule", "message"] as const;
	const selected: Record<string, string> = {};
	for (const name of names) {
		const dotted: unknown = field(select, name);
		if (typeof dotted !== "string" || dotted.length === 0) {
			return withId(`needs a select.${name} dotted path`);
		}
		selected[name] = dotted;
	}
	const at = (name: string): string => selected[name] ?? "";
	return ok({
		format,
		source: output,
		select: {
			results: at("results"),
			path: at("path"),
			line: at("line"),
			rule: at("rule"),
			message: at("message"),
		},
		pattern: undefined,
	});
}

function narrowRegexPattern(
	withId: (detail: string) => Result<never>,
	format: "regex",
	output: "stdout" | "{out}",
	raw: unknown,
): Result<ExternalOutput> {
	if (typeof raw !== "string" || raw.length === 0) {
		return withId("needs a pattern for regex output");
	}
	const safe = checkPattern(raw);
	if (!safe.ok) {
		return err(safe.error);
	}
	let pattern: RegExp;
	try {
		pattern = new RegExp(raw);
	} catch {
		return withId("carries a regex the engine rejects");
	}
	return ok({ format, source: output, select: undefined, pattern });
}

function codeList(value: unknown): Array<number> | undefined {
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "number" && Number.isInteger(entry))
	) {
		return [...value];
	}
	return undefined;
}

// SPEC §4.4.5 declaration: input mode, output binding and exit-code lists.
// Defaults keep hand-written packs working: files in, stdout out, 0 clean,
// 1 findings.
export function narrowExternalArgs(
	declId: string,
	args: unknown,
): Result<ExternalArgs> {
	const record = isRecord(args) ? args : {};
	const input: unknown = field(record, "input") ?? "files";
	if (typeof input !== "string" || !isExternalInput(input)) {
		return toolError(
			"CDX-E203",
			`pack enforcer "${declId}" needs an input of file, files, staged, diff, repo or stdin-json`,
		);
	}
	const output = narrowOutput(
		declId,
		field(record, "output") ?? { format: "exit-code" },
	);
	if (!output.ok) {
		return err(output.error);
	}
	const codes: unknown = field(record, "exitCodes");
	const passCodes = (isRecord(codes)
		? codeList(field(codes, "pass"))
		: undefined) ?? [0];
	const findingCodes = (isRecord(codes)
		? codeList(field(codes, "findings"))
		: undefined) ?? [1];
	for (const code of passCodes) {
		if (findingCodes.includes(code)) {
			return toolError(
				"CDX-E203",
				`pack enforcer "${declId}" lists exit code ${String(code)} as both pass and findings`,
			);
		}
	}
	const timeout: unknown = field(record, "timeoutMs");
	return ok({
		input,
		output: output.value,
		passCodes,
		findingCodes,
		timeoutMs:
			typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0
				? timeout
				: undefined,
	});
}
