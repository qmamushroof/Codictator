// SPEC §4.4.6 file-required: required files exist, and required content is
// present inside them. Missing files and absent content each fail closed
// with their own finding; the scope never restricts the check because the
// requirement is about the tree, not the trigger.

import type { Ports } from "../../../kernel/index.ts";
import { err, ok, type Result } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import { field, isRecord } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	stringList,
} from "./binding.ts";

export interface RequiredConfig {
	readonly files: ReadonlyArray<string>;
	readonly contains: Readonly<Record<string, string>>;
}

export function narrowRequiredArgs(
	declId: string,
	args: unknown,
): Result<RequiredConfig> {
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const files = stringList(field(record.value, "files")) ?? [];
	if (files.length === 0 || files.some((file) => file.length === 0)) {
		return bindingError(declId, "needs a non-empty files list in args");
	}
	const rawContains: unknown = field(record.value, "contains") ?? {};
	if (!isRecord(rawContains)) {
		return bindingError(declId, "needs a contains object in args");
	}
	const contains: Record<string, string> = {};
	for (const key of Object.keys(rawContains)) {
		const need: unknown = rawContains[key];
		if (typeof need !== "string") {
			return bindingError(declId, "needs string values in contains");
		}
		contains[key] = need;
	}
	return ok({ files: [...files].sort(), contains });
}

export async function checkRequired(
	ports: Ports,
	binding: RuleBinding,
	config: RequiredConfig,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const file of config.files) {
		const seen = await ports.fs.exists(file);
		if (!seen.ok) {
			findings.push(readErrorFinding(binding, file, seen.error, "stat"));
			continue;
		}
		if (!seen.value) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `required file missing: ${file}`,
					vars: { path: file },
				}),
			);
			continue;
		}
		const need: unknown = config.contains[file];
		if (typeof need !== "string") {
			continue;
		}
		const loaded = await readLossyText(ports.fs, file);
		if (!loaded.ok) {
			findings.push(readErrorFinding(binding, file, loaded.error, "read"));
			continue;
		}
		if (!loaded.value.text.includes(need)) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `required content absent from ${file}`,
					vars: { path: file },
				}),
			);
		}
	}
	return findings;
}
