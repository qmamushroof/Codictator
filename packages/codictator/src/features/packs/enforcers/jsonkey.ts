// SPEC §4.4.6 json-key: a required key or value is present in a JSON file,
// or a forbidden one is absent. Dotted paths walk records and arrays; the
// comparison is canonical JSON, so key order never matters. Values never
// reach a message: only the key and the file are named (§9.2).

import type { Ports } from "../../../kernel/index.ts";
import {
	err,
	ok,
	parseJson,
	type Result,
	stableStringify,
} from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import { field, isRecord } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	nonEmptyString,
	type RuleBinding,
	readErrorFinding,
} from "./binding.ts";

export interface JsonKeyConfig {
	readonly file: string;
	readonly key: string;
	readonly mode: "required" | "forbidden";
	readonly hasValue: boolean;
	readonly value: unknown;
}

export function narrowJsonKeyArgs(
	declId: string,
	args: unknown,
): Result<JsonKeyConfig> {
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const file: unknown = field(record.value, "file");
	const key: unknown = field(record.value, "key");
	if (!nonEmptyString(file) || !nonEmptyString(key)) {
		return bindingError(declId, "needs non-empty file and key strings in args");
	}
	const mode: unknown = field(record.value, "mode") ?? "required";
	if (mode !== "required" && mode !== "forbidden") {
		return bindingError(
			declId,
			"needs a mode of required or forbidden in args",
		);
	}
	return ok({
		file,
		key,
		mode,
		hasValue: "value" in record.value,
		value: field(record.value, "value"),
	});
}

function atPath(document: unknown, key: string): unknown {
	let current: unknown = document;
	for (const segment of key.split(".")) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0) {
				return undefined;
			}
			current = current[index];
		} else if (isRecord(current)) {
			current = field(current, segment);
		} else {
			return undefined;
		}
		if (current === undefined) {
			return undefined;
		}
	}
	return current;
}

export async function checkJsonKey(
	ports: Ports,
	binding: RuleBinding,
	config: JsonKeyConfig,
): Promise<Array<Finding>> {
	const loaded = await ports.fs.readText(config.file);
	if (!loaded.ok) {
		return [readErrorFinding(binding, config.file, loaded.error, "read")];
	}
	const parsed = parseJson(loaded.value);
	if (!parsed.ok) {
		return [readErrorFinding(binding, config.file, parsed.error, "parse")];
	}
	const found = atPath(parsed.value, config.key);
	const vars = { path: config.file, detail: config.key };
	if (config.mode === "forbidden") {
		if (found !== undefined) {
			return [
				findingFor(binding, {
					path: config.file,
					message: `forbidden key ${config.key} present in ${config.file}`,
					vars,
				}),
			];
		}
		return [];
	}
	if (found === undefined) {
		return [
			findingFor(binding, {
				path: config.file,
				message: `required key ${config.key} absent from ${config.file}`,
				vars,
			}),
		];
	}
	if (
		config.hasValue &&
		stableStringify(found) !== stableStringify(config.value)
	) {
		return [
			findingFor(binding, {
				path: config.file,
				message: `required key ${config.key} has an unexpected value in ${config.file}`,
				vars,
			}),
		];
	}
	return [];
}
