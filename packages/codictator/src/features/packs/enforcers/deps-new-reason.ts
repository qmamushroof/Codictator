// SPEC §4.8.5 core/dep-new-needs-reason, split from the live dependency
// reads (deps-live) by responsibility (BUG-0107).

import { findingFor } from "./binding.ts";
import { collectPinRanges } from "./deps-guards.ts";
import type { ManifestFile } from "./deps-live.ts";
import { loadScopeText } from "./health-measures.ts";
import type { MarkerRealArgs } from "./marker-scan.ts";

// SPEC §7.7 grammar: `+ name@x.y.z — reason — rung` is the record of an
// added dependency. The em dash is U+2014.
const DEPS_ADDED = /^- \*\*Deps:\*\* \+ (\S+)@[^\s@]+ — \S.* — \S/;

// SPEC §4.8.5 core/dep-new-needs-reason: a dependency the staged manifest
// holds and HEAD does not needs a staged history Deps line with a reason and
// a rung. HEAD is the base at L3; the L4 range carries no base on the scope.
export async function judgeNewDeps(
	args: MarkerRealArgs,
	manifests: ReadonlyArray<ManifestFile>,
): Promise<void> {
	const recorded = new Set<string>();
	for (const file of args.files.filter((name) =>
		/^docs\/HISTORY\/[^/]+\.md$/.test(name),
	)) {
		const text = await loadScopeText(
			args.ports,
			args.binding,
			file,
			args.findings,
		);
		for (const line of (text ?? "").split("\n")) {
			const name = DEPS_ADDED.exec(line.trim())?.[1];
			if (name !== undefined) {
				recorded.add(name);
			}
		}
	}
	for (const manifest of manifests) {
		const base = await args.ports.git.show("HEAD", manifest.path);
		const before = new Set(
			(base.ok ? collectPinRanges(base.value) : []).map((dep) => dep.name),
		);
		for (const { name } of manifest.deps) {
			if (!before.has(name) && !recorded.has(name)) {
				args.findings.push(
					findingFor(args.binding, {
						path: manifest.path,
						message: `${name} in ${manifest.path} has no recorded reason`,
						vars: { path: manifest.path, value: name },
					}),
				);
			}
		}
	}
}
