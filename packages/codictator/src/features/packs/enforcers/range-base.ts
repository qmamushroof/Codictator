// SPEC §4.10.4 + §4.15.1: the L4 range judges. `ci verify` threads the
// range base on the scope; a rule with a range judge then compares the
// base and head of each changed file (or reads the head state a range
// change touches) after its fixture-marker judge. Without a base (L1–L3,
// tree review) the wrapper adds nothing, so the marker verdicts stand.
import type { Ports, Result } from "../../../kernel/index.ts";
import { isFixturePath, ok, parseJson } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import { bindRule, findingFor, type RuleBinding } from "./binding.ts";
import { isMarkerFile } from "./health-markers.ts";
import { loadScopeText } from "./health-measures.ts";

export interface RangeArgs {
	readonly ports: Ports;
	readonly binding: RuleBinding;
	readonly ctx: CheckContext;
	readonly base: string;
	// The range's changed files, marker reports left to the marker judge.
	readonly files: ReadonlyArray<string>;
	readonly findings: Array<Finding>;
}

export type RangeJudge = (args: RangeArgs) => Promise<void>;

export function withRangeJudge(
	resolved: Result<Enforcer>,
	rule: PackRule,
	ports: Ports,
	judge: RangeJudge,
): Result<Enforcer> {
	if (!resolved.ok) {
		return resolved;
	}
	const binding = bindRule(rule);
	const inner = resolved.value;
	return ok({
		...inner,
		check: async (ctx, params) => {
			const own = await inner.check(ctx, params);
			const base = ctx.scope.base;
			if (base === undefined) {
				return own;
			}
			const findings: Array<Finding> = [];
			const files = ctx.scope.files.filter((file) => !isMarkerFile(file));
			await judge({ ports, binding, ctx, base, files, findings });
			return [...own, ...findings];
		},
	});
}

// A changed file's text at the base commit; a file the range adds has none.
export async function baseText(
	args: RangeArgs,
	file: string,
): Promise<string | undefined> {
	const shown = await args.ports.git.show(args.base, file);
	return shown.ok ? shown.value : undefined;
}

// The base and head texts of each changed file the filter keeps. Fixture
// trees hold test vectors, so only a judge that targets them opts in.
export async function forEachBaseHead(
	args: RangeArgs,
	keep: (file: string) => boolean,
	visit: (file: string, before: string, after: string) => void,
): Promise<void> {
	for (const file of args.files.filter(keep)) {
		const after = await loadScopeText(
			args.ports,
			args.binding,
			file,
			args.findings,
		);
		if (after !== undefined) {
			visit(file, (await baseText(args, file)) ?? "", after);
		}
	}
}

export function notFixture(file: string): boolean {
	return !isFixturePath(file);
}

// Line multiset difference: how many head lines are new and how many base
// lines are gone, matched on exact text.
export function lineChurn(
	before: string,
	after: string,
): { readonly added: number; readonly removed: number } {
	const pool = new Map<string, number>();
	const lines = (text: string): Array<string> =>
		text === "" ? [] : text.replace(/\n$/, "").split("\n");
	for (const line of lines(before)) {
		pool.set(line, (pool.get(line) ?? 0) + 1);
	}
	let added = 0;
	for (const line of lines(after)) {
		const left = pool.get(line) ?? 0;
		if (left > 0) {
			pool.set(line, left - 1);
		} else {
			added += 1;
		}
	}
	let removed = 0;
	for (const left of pool.values()) {
		removed += left;
	}
	return { added, removed };
}

export function countMatches(text: string, pattern: RegExp): number {
	return [...text.matchAll(pattern)].length;
}

export function flagRange(
	args: RangeArgs,
	file: string,
	message: string,
	value?: string,
): void {
	args.findings.push(
		findingFor(args.binding, {
			path: file,
			message,
			vars: value === undefined ? { path: file } : { path: file, value },
		}),
	);
}

// A head JSON file's parsed value; absent, unreadable or unparseable reads
// as none.
export async function headJson(
	args: RangeArgs,
	file: string,
): Promise<unknown> {
	const seen = await args.ports.fs.exists(file);
	if (!seen.ok || !seen.value) {
		return undefined;
	}
	const text = await loadScopeText(args.ports, args.binding, file, []);
	if (text === undefined) {
		return undefined;
	}
	const parsed = parseJson(text);
	return parsed.ok ? parsed.value : undefined;
}

export function parseJsonText(text: string): unknown {
	const parsed = parseJson(text);
	return parsed.ok ? parsed.value : undefined;
}
