// SPEC §4.4.6 file-size: source files stay under maxLines lines and every
// committed file under maxBytes bytes (§5.6). Limits bind from the pack
// args first, then the rule tunables; a kind with neither limit fails the
// load instead of checking nothing.

import type { Ports } from "../../../kernel/index.ts";
import { err, ok, type Result } from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import { field } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	nonNegativeInteger,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
	tunableNumber,
} from "./binding.ts";

export interface SizeConfig {
	readonly maxLines: number | undefined;
	readonly maxBytes: number | undefined;
}

function countLines(text: string): number {
	if (text === "") {
		return 0;
	}
	const parts = text.split("\n");
	const last = parts[parts.length - 1];
	return parts.length - (last === "" ? 1 : 0);
}

export function narrowSizeArgs(
	declId: string,
	binding: RuleBinding,
	args: unknown,
): Result<SizeConfig> {
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const argLines: unknown = field(record.value, "maxLines");
	const argBytes: unknown = field(record.value, "maxBytes");
	if (argLines !== undefined && !nonNegativeInteger(argLines)) {
		return bindingError(
			declId,
			"needs a non-negative integer maxLines in args",
		);
	}
	if (argBytes !== undefined && !nonNegativeInteger(argBytes)) {
		return bindingError(
			declId,
			"needs a non-negative integer maxBytes in args",
		);
	}
	const maxLines =
		(nonNegativeInteger(argLines) ? argLines : undefined) ??
		tunableNumber(binding, "maxLines");
	const maxBytes =
		(nonNegativeInteger(argBytes) ? argBytes : undefined) ??
		tunableNumber(binding, "maxBytes");
	if (maxLines === undefined && maxBytes === undefined) {
		return bindingError(declId, "needs a maxLines or maxBytes limit");
	}
	return ok({ maxLines, maxBytes });
}

export async function checkSize(
	ports: Ports,
	binding: RuleBinding,
	config: SizeConfig,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
		const loaded = await readLossyText(ports.fs, file);
		if (!loaded.ok) {
			findings.push(readErrorFinding(binding, file, loaded.error, "read"));
			continue;
		}
		if (config.maxBytes !== undefined && loaded.value.bytes > config.maxBytes) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `file over the byte limit: ${file}`,
					vars: {
						path: file,
						limit: String(config.maxBytes),
						value: String(loaded.value.bytes),
					},
				}),
			);
		}
		const lines = countLines(loaded.value.text);
		if (config.maxLines !== undefined && lines > config.maxLines) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `file over the line limit: ${file}`,
					vars: {
						path: file,
						limit: String(config.maxLines),
						value: String(lines),
					},
				}),
			);
		}
	}
	return findings;
}
