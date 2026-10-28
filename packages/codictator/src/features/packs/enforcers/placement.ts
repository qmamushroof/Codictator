// SPEC §4.4.6 path-placement: files live in allowed locations, never in
// denied ones. The allowedGlobs tunable is additive (§5.10): the pack args
// and the rule tunable unite, so either layer can own locations.
import { err, globMatch, ok, type Result } from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import { field } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	type RuleBinding,
	selectFiles,
	stringList,
	tunableStringList,
} from "./binding.ts";

export interface PlacementConfig {
	readonly paths: ReadonlyArray<string>;
	readonly allowed: ReadonlyArray<string>;
	readonly denied: ReadonlyArray<string>;
}

function unionSorted(
	lists: ReadonlyArray<ReadonlyArray<string>>,
): Array<string> {
	return [...new Set(lists.flat())].sort();
}

export function narrowPlacementArgs(
	declId: string,
	binding: RuleBinding,
	args: unknown,
): Result<PlacementConfig> {
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const allowed = unionSorted([
		stringList(field(record.value, "allowedGlobs")) ?? [],
		tunableStringList(binding, "allowedGlobs") ?? [],
	]);
	const denied = unionSorted([
		stringList(field(record.value, "deniedGlobs")) ?? [],
		tunableStringList(binding, "deniedGlobs") ?? [],
	]);
	const paths = stringList(field(record.value, "paths")) ?? [];
	for (const glob of [...paths, ...allowed, ...denied]) {
		if (glob.length === 0) {
			return bindingError(declId, "needs non-empty globs in args");
		}
	}
	return ok({ paths, allowed, denied });
}

export function checkPlacement(
	binding: RuleBinding,
	config: PlacementConfig,
	ctx: CheckContext,
): Array<Finding> {
	const selected = selectFiles(ctx.scope.files, binding.scopeGlobs);
	const candidates =
		config.paths.length === 0
			? selected
			: selected.filter((file) =>
					config.paths.some((glob) => globMatch(glob, file)),
				);
	const findings: Array<Finding> = [];
	for (const file of candidates) {
		const denied = config.denied.some((glob) => globMatch(glob, file));
		const allowed =
			config.allowed.length === 0 ||
			config.allowed.some((glob) => globMatch(glob, file));
		if (!denied && allowed) {
			continue;
		}
		const reason = denied
			? "in a denied location"
			: "outside its allowed locations";
		findings.push(
			findingFor(binding, {
				path: file,
				message: `file ${reason}: ${file}`,
				vars: { path: file },
			}),
		);
	}
	return findings;
}
