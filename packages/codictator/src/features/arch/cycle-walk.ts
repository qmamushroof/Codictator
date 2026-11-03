// SPEC §4.11: shared depth-first cycle walk over a module dependency map.
// Both the evaluation-path check (checks.ts) and the config validation
// (module-map-validation.ts) judge acyclicity the same way; this single
// helper keeps the two call sites behavior-identical.
export function findModuleCycle(
	names: ReadonlyArray<string>,
	depends: ReadonlyMap<string, ReadonlyArray<string>>,
	shouldSkip?: (dep: string) => boolean,
): Array<string> | undefined {
	const visiting = new Set<string>();
	const done = new Set<string>();
	const walk = (
		name: string,
		trail: ReadonlyArray<string>,
	): Array<string> | undefined => {
		if (done.has(name)) {
			return undefined;
		}
		if (visiting.has(name)) {
			return [...trail.slice(trail.indexOf(name)), name];
		}
		visiting.add(name);
		for (const dep of depends.get(name) ?? []) {
			if (shouldSkip?.(dep) === true) {
				continue;
			}
			const found = walk(dep, [...trail, name]);
			if (found !== undefined) {
				return found;
			}
		}
		visiting.delete(name);
		done.add(name);
		return undefined;
	};
	for (const name of names) {
		const found = walk(name, []);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}
