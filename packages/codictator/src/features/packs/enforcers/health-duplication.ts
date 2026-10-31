// SPEC §5.6 core/duplication: no duplicated token run above minTokens
// (§6.1: minTokens 50 default, 100 bound, stricter lower; L4; R). Marker
// files carry the fixture measure report; source files are tokenized over
// blankCode output, so comments and string bodies never count. A window run
// shared across files flags the earliest site in each file; findings sort
// by path and line, so the verdict is deterministic (§4.3.6).
import type { Ports, Result } from "../../../kernel/index.ts";
import { ok } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	isTestPath,
	type RuleBinding,
	selectFiles,
} from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import {
	baseEnforcer,
	isMarkerFile,
	isTsFile,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §6.1: words, numbers and single punctuation marks. String and
// comment bodies are already blanked, so only live code shapes the run.
const LEXEME_PATTERN =
	/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_$]/g;

interface SourceToken {
	readonly text: string;
	readonly line: number;
}

function tokenizeSource(blanked: string): Array<SourceToken> {
	const starts: Array<number> = [0];
	for (let index = 0; index < blanked.length; index += 1) {
		if (blanked.charAt(index) === "\n") {
			starts.push(index + 1);
		}
	}
	const tokens: Array<SourceToken> = [];
	for (const match of blanked.matchAll(LEXEME_PATTERN)) {
		const at = match.index ?? 0;
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if ((starts[mid] ?? 0) <= at) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		tokens.push({ text: match[0], line: low + 1 });
	}
	return tokens;
}

function pairKey(first: string, second: string): string {
	return JSON.stringify([first, second]);
}

function sharedLength(
	first: ReadonlyArray<SourceToken>,
	firstStart: number,
	second: ReadonlyArray<SourceToken>,
	secondStart: number,
): number {
	let length = 0;
	while (
		firstStart + length < first.length &&
		secondStart + length < second.length &&
		first[firstStart + length]?.text === second[secondStart + length]?.text
	) {
		length += 1;
	}
	return length;
}

function compareFindings(left: Finding, right: Finding): number {
	const leftPath = left.path ?? "";
	const rightPath = right.path ?? "";
	if (leftPath < rightPath) {
		return -1;
	}
	if (leftPath > rightPath) {
		return 1;
	}
	return (left.line ?? 0) - (right.line ?? 0);
}

// SPEC §5.6: the measure is a cross-file run of at least minTokens tokens.
// The window index below finds every shared run; each file pair reports its
// earliest shared site once, extended to the full shared run.
function sharedRunFindings(
	binding: RuleBinding,
	files: ReadonlyArray<string>,
	sources: ReadonlyMap<string, string>,
	minTokens: number,
): Array<Finding> {
	if (minTokens < 1) {
		return [];
	}
	const tokened = new Map<string, Array<SourceToken>>();
	for (const file of files) {
		const text = sources.get(file);
		if (text === undefined || isMarkerFile(file)) {
			continue;
		}
		if (!isTsFile(file) || isTestPath(file)) {
			continue;
		}
		const lexemes = tokenizeSource(blankCode(text));
		if (lexemes.length >= minTokens) {
			tokened.set(file, lexemes);
		}
	}
	const windows = new Map<string, Map<string, number>>();
	for (const [file, tokens] of tokened) {
		for (let start = 0; start + minTokens <= tokens.length; start += 1) {
			const key = tokens
				.slice(start, start + minTokens)
				.map((token) => token.text)
				.join(" ");
			let owners = windows.get(key);
			if (owners === undefined) {
				owners = new Map<string, number>();
				windows.set(key, owners);
			}
			if (!owners.has(file)) {
				owners.set(file, start);
			}
		}
	}
	interface PairSites {
		readonly first: string;
		readonly firstStart: number;
		readonly second: string;
		readonly secondStart: number;
	}
	const pairs = new Map<string, PairSites>();
	for (const key of [...windows.keys()].sort()) {
		const owners = windows.get(key);
		if (owners === undefined || owners.size < 2) {
			continue;
		}
		const ranked = [...owners.keys()].sort();
		for (let left = 0; left < ranked.length; left += 1) {
			for (let right = left + 1; right < ranked.length; right += 1) {
				const first = ranked[left] ?? "";
				const second = ranked[right] ?? "";
				const firstStart = owners.get(first) ?? 0;
				const secondStart = owners.get(second) ?? 0;
				const seen = pairs.get(pairKey(first, second));
				if (seen === undefined) {
					pairs.set(pairKey(first, second), {
						first,
						firstStart,
						second,
						secondStart,
					});
				} else {
					pairs.set(pairKey(first, second), {
						first,
						firstStart: Math.min(seen.firstStart, firstStart),
						second,
						secondStart: Math.min(seen.secondStart, secondStart),
					});
				}
			}
		}
	}
	interface SiteRun {
		readonly file: string;
		readonly line: number;
		readonly run: number;
	}
	const sites = new Map<string, SiteRun>();
	for (const entry of pairs.values()) {
		const firstTokens = tokened.get(entry.first) ?? [];
		const secondTokens = tokened.get(entry.second) ?? [];
		const run = sharedLength(
			firstTokens,
			entry.firstStart,
			secondTokens,
			entry.secondStart,
		);
		const ends: ReadonlyArray<{ file: string; line: number }> = [
			{ file: entry.first, line: firstTokens[entry.firstStart]?.line ?? 1 },
			{ file: entry.second, line: secondTokens[entry.secondStart]?.line ?? 1 },
		];
		for (const end of ends) {
			const key = pairKey(end.file, String(end.line));
			const seen = sites.get(key);
			if (seen === undefined || run > seen.run) {
				sites.set(key, { file: end.file, line: end.line, run });
			}
		}
	}
	const findings: Array<Finding> = [];
	for (const site of sites.values()) {
		findings.push(
			findingFor(binding, {
				path: site.file,
				line: site.line,
				message: `duplicated token run over the limit at ${site.file}:${String(site.line)}`,
				vars: {
					path: site.file,
					line: String(site.line),
					limit: String(minTokens),
					value: String(site.run),
				},
			}),
		);
	}
	return findings;
}

export function resolveDuplication(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const minTokens = limitOf(binding, "minTokens", 50);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			const files = selectFiles(ctx.scope.files, binding.scopeGlobs);
			const sources = new Map<string, string>();
			for (const file of files) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text !== undefined) {
					sources.set(file, text);
				}
			}
			for (const file of files) {
				const text = sources.get(file);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const duplicated = parseMarkerInt(
					parseMarkers(text),
					"duplicated-tokens",
				);
				if (duplicated !== undefined && duplicated > minTokens) {
					findings.push(
						findingFor(binding, {
							path: file,
							line: 1,
							message: `duplicated token run over the limit in ${file}`,
							vars: {
								path: file,
								line: "1",
								limit: String(minTokens),
								value: String(duplicated),
							},
						}),
					);
				}
			}
			findings.push(...sharedRunFindings(binding, files, sources, minTokens));
			findings.sort(compareFindings);
			return findings;
		}),
	);
}
