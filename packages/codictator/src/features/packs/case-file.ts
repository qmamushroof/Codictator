// SPEC §4.4.1: read and narrow one case.json. A case that is missing or
// malformed is an error value here; self-test turns it into the failure
// code of the directory it sits under (CDX-E212 violating, CDX-E213 passing).
import type { Fs, Result } from "../../kernel/index.ts";
import { err, makeError, ok, parseJson, TRIGGERS } from "../../kernel/index.ts";
import type { Trigger } from "../engine/index.ts";

export type CaseKind = "violating" | "passing";

export interface CaseFile {
	readonly trigger: Trigger;
	readonly expectRules: ReadonlyArray<string>;
	readonly files: Readonly<Record<string, string>>;
}

// Where a pack's fixtures/ tree is read from: the pack directory in the
// form `fs` reads it.
export interface CaseSource {
	readonly fs: Fs;
	readonly dir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function triggerOf(value: unknown): Trigger | undefined {
	return TRIGGERS.find((trigger) => trigger === value);
}

function stringMap(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, text] of Object.entries(value)) {
		if (typeof text !== "string") {
			return undefined;
		}
		out[key] = text;
	}
	return out;
}

function stringList(value: unknown): Array<string> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out: Array<string> = [];
	for (const item of value) {
		if (typeof item !== "string") {
			return undefined;
		}
		out.push(item);
	}
	return out;
}

// SPEC §4.4.1: `rule` and `expectation` must name the rule and directory
// the case sits under; every other field has the stated type.
function narrow(
	value: unknown,
	rule: string,
	kind: CaseKind,
): CaseFile | undefined {
	if (!isRecord(value) || value["rule"] !== rule) {
		return undefined;
	}
	const trigger = triggerOf(value["trigger"]);
	const expectRules = stringList(value["expectRules"]);
	const files = stringMap(value["files"]);
	if (
		value["expectation"] !== kind ||
		trigger === undefined ||
		expectRules === undefined ||
		files === undefined
	) {
		return undefined;
	}
	return { trigger, expectRules, files };
}

function caseFailure(
	kind: CaseKind,
	rule: string,
	what: string,
): Result<never> {
	return err(
		makeError(
			kind === "violating" ? "CDX-E212" : "CDX-E213",
			`rule "${rule}" ${kind} ${what}`,
			"Repair or restore the case.json named in the pack.json fixtures list (§4.4.1), then re-run the self-test.",
		),
	);
}

export async function readCaseFile(
	source: CaseSource,
	slug: string,
	rule: string,
	kind: CaseKind,
	name: string,
): Promise<Result<CaseFile>> {
	const path = `${source.dir}/fixtures/${slug}/${kind}/${name}/case.json`;
	const text = await source.fs.readText(path);
	if (!text.ok) {
		return caseFailure(kind, rule, `case file ${path} cannot be read`);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return caseFailure(kind, rule, `case file ${path} is not valid JSON`);
	}
	const narrowed = narrow(parsed.value, rule, kind);
	if (narrowed === undefined) {
		return caseFailure(
			kind,
			rule,
			`case file ${path} does not match the §4.4.1 case shape`,
		);
	}
	return ok(narrowed);
}
