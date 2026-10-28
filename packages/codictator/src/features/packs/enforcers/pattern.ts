// SPEC §4.4.6 pattern-forbid and pattern-require: a kernel-checked regex
// over files matching globs. Forbid flags every matching line; require
// flags every file with no matching line. No file content ever reaches a
// message (§9.2); the per-file scan is line-wise so an unsafe pattern
// cannot hide inside a long line.

import type { Ports } from "../../../kernel/index.ts";
import {
	checkPattern,
	err,
	globMatch,
	ok,
	type Result,
} from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import { field } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	nonEmptyString,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
	stringList,
} from "./binding.ts";

export interface PatternConfig {
	readonly pattern: RegExp;
	readonly paths: ReadonlyArray<string>;
}

// SPEC §9.2: the kernel safety check runs before any compile, and the
// compile itself still cannot throw past the loader. One compilation per
// load, reused by every check.
export function narrowPatternArgs(
	declId: string,
	args: unknown,
): Result<PatternConfig> {
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const raw: unknown = field(record.value, "pattern");
	if (!nonEmptyString(raw)) {
		return bindingError(declId, "needs a non-empty string pattern in args");
	}
	const safe = checkPattern(raw);
	if (!safe.ok) {
		return err(safe.error);
	}
	let pattern: RegExp;
	try {
		pattern = new RegExp(raw);
	} catch {
		return bindingError(declId, "carries a pattern the regex engine rejects");
	}
	return ok({ pattern, paths: stringList(field(record.value, "paths")) ?? [] });
}

function patternCandidates(
	binding: RuleBinding,
	config: PatternConfig,
	ctx: CheckContext,
): Array<string> {
	const selected = selectFiles(ctx.scope.files, binding.scopeGlobs);
	if (config.paths.length === 0) {
		return selected;
	}
	return selected.filter((file) =>
		config.paths.some((glob) => globMatch(glob, file)),
	);
}

export async function checkPatternForbid(
	ports: Ports,
	binding: RuleBinding,
	config: PatternConfig,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const file of patternCandidates(binding, config, ctx)) {
		const loaded = await readLossyText(ports.fs, file);
		if (!loaded.ok) {
			findings.push(readErrorFinding(binding, file, loaded.error, "read"));
			continue;
		}
		let line = 0;
		for (const content of loaded.value.text.split("\n")) {
			line += 1;
			if (config.pattern.test(content)) {
				findings.push(
					findingFor(binding, {
						path: file,
						line,
						message: `forbidden pattern matched ${file}:${String(line)}`,
						vars: { path: file, line: String(line) },
					}),
				);
			}
		}
	}
	return findings;
}

export async function checkPatternRequire(
	ports: Ports,
	binding: RuleBinding,
	config: PatternConfig,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const file of patternCandidates(binding, config, ctx)) {
		const loaded = await readLossyText(ports.fs, file);
		if (!loaded.ok) {
			findings.push(readErrorFinding(binding, file, loaded.error, "read"));
			continue;
		}
		let matched = false;
		for (const content of loaded.value.text.split("\n")) {
			if (config.pattern.test(content)) {
				matched = true;
				break;
			}
		}
		if (!matched) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `required pattern absent from ${file}`,
					vars: { path: file },
				}),
			);
		}
	}
	return findings;
}
