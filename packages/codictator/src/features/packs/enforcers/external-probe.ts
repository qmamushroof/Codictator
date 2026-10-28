// SPEC §4.4.5 version probe: the probe runs once per tool per enforcer
// lifetime (the session cache); its output must match the pattern, and a
// capture group must equal the pin. Anything else is CDX-E208 and blocks.
// A probe that never starts is CDX-E209. The Fs port exposes no mtime, so
// the key is the tool id rather than path plus mtime.

import type { Ports } from "../../../kernel/index.ts";
import {
	checkPattern,
	err,
	makeError,
	ok,
	type Result,
} from "../../../kernel/index.ts";
import { field, isRecord } from "../manifest.ts";
import type { ToolDecl } from "./external.ts";
import { executeBatch } from "./external-runs.ts";

function probeError(code: string, detail: string): Result<never> {
	return err(
		makeError(
			code,
			detail,
			"Fix the external tool or its version binding, then retry the hook.",
		),
	);
}

export async function probeToolVersion(
	ports: Ports,
	tool: ToolDecl,
	cache: Map<string, string>,
): Promise<Result<string>> {
	const cached = cache.get(tool.id);
	if (cached !== undefined) {
		return ok(cached);
	}
	const probed = await executeBatch(ports, {
		argv: [...tool.version.probe],
		stdin: undefined,
		outPath: undefined,
		timeoutMs: tool.timeoutMs,
		env: {},
	});
	if (!probed.ok) {
		if (probed.error.code === "CDX-E209") {
			return err(probed.error);
		}
		return probeError("CDX-E207", `external tool "${tool.id}" probe failed`);
	}
	if (probed.timedOut) {
		return probeError("CDX-E902", `external tool "${tool.id}" probe timed out`);
	}
	if (probed.truncated || probed.code !== 0) {
		return probeError("CDX-E207", `external tool "${tool.id}" probe failed`);
	}
	const safe = checkPattern(tool.version.pattern);
	if (!safe.ok) {
		return err(safe.error);
	}
	let matched: RegExpExecArray | null;
	try {
		matched = new RegExp(tool.version.pattern).exec(probed.text);
	} catch {
		return probeError(
			"CDX-E203",
			`tool "${tool.id}" carries a bad version pattern`,
		);
	}
	if (matched === null) {
		return probeError(
			"CDX-E208",
			`external tool "${tool.id}" version output matches nothing pinned`,
		);
	}
	const groups: unknown = matched.groups;
	const named: unknown = isRecord(groups)
		? field(groups, "version")
		: undefined;
	const captured: unknown = matched[1];
	const reported =
		typeof named === "string"
			? named
			: typeof captured === "string"
				? captured
				: tool.version.pin;
	if (reported !== tool.version.pin) {
		return probeError(
			"CDX-E208",
			`external tool "${tool.id}" reports ${reported}, pinned ${tool.version.pin}`,
		);
	}
	cache.set(tool.id, reported);
	return ok(reported);
}
