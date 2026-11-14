// SPEC §6.1, §6.3 security-patterns resolvers: one shared line scanner, so
// the ts and python resolvers pass only their patterns, their language test
// and an optional sanctioned-line exemption (core/duplication).
import {
	checkPattern,
	err,
	ok,
	type Ports,
	type Result,
} from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, type RuleBinding } from "./binding.ts";
import { forEachEffectiveText } from "./pre-tool-files.ts";

export interface RawPattern {
	readonly id: string;
	readonly pattern: string;
}

interface CompiledPattern {
	readonly id: string;
	readonly pattern: RegExp;
}

// A line the language sanctions despite its pattern matching.
export type LineExemption = (id: string, content: string) => boolean;

// One finding per line at most: the first dangerous pattern on it blocks.
function scanLines(
	binding: RuleBinding,
	compiled: ReadonlyArray<CompiledPattern>,
	exempt: LineExemption | undefined,
	file: string,
	text: string,
): Array<Finding> {
	const findings: Array<Finding> = [];
	let line = 0;
	for (const content of text.split("\n")) {
		line += 1;
		const hit = compiled.find(
			(entry) =>
				entry.pattern.test(content) && !(exempt?.(entry.id, content) ?? false),
		);
		if (hit !== undefined) {
			findings.push(
				findingFor(binding, {
					path: file,
					line,
					message: `dangerous pattern ${hit.id} in ${file}:${String(line)}`,
					vars: { path: file, line: String(line) },
				}),
			);
		}
	}
	return findings;
}

export function resolveLinePatterns(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	raw: ReadonlyArray<RawPattern>,
	isLanguageFile: (path: string) => boolean,
	exempt?: LineExemption,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const compiled: Array<CompiledPattern> = [];
	for (const entry of raw) {
		const safe = checkPattern(entry.pattern);
		if (!safe.ok) {
			return err(safe.error);
		}
		compiled.push({ id: entry.id, pattern: new RegExp(entry.pattern) });
	}
	return ok({
		id: rule.id,
		kinds: binding.triggers,
		budgetMs: decl.budgetMs,
		check: async (ctx): Promise<Array<Finding>> => {
			const findings: Array<Finding> = [];
			await forEachEffectiveText(
				ctx,
				ports,
				binding,
				findings,
				"lines",
				(entry, text) => {
					if (isLanguageFile(entry.path)) {
						findings.push(
							...scanLines(binding, compiled, exempt, entry.path, text),
						);
					}
				},
			);
			return findings;
		},
	});
}
