// SPEC §4.11.2: adding a dependsOn edge is a design change, allowed only
// when the graph stays acyclic. Config validation owns the same check; this
// pure form lets the arch guard refuse a cyclic map with CDX-E105.
import {
	type CdxError,
	err,
	makeError,
	ok,
	type Result,
} from "../../kernel/index.ts";
import { findModuleCycle } from "./cycle-walk.ts";
import type { ModuleNode } from "./index.ts";

function cycleError(trail: ReadonlyArray<string>): CdxError {
	return makeError(
		"CDX-E105",
		`architecture change closes a cycle: ${trail.join(" -> ")}`,
		"Remove a dependsOn edge so the module graph stays acyclic (SPEC §4.11.2).",
	);
}

export function validateModuleMap(
	modules: ReadonlyArray<ModuleNode>,
): Result<ReadonlyArray<ModuleNode>> {
	const deps = new Map<string, ReadonlyArray<string>>();
	for (const mod of modules) {
		if (deps.has(mod.name)) {
			return err(
				makeError(
					"CDX-E105",
					`duplicate module name "${mod.name}"`,
					"Give every architecture module a unique name, then retry.",
				),
			);
		}
		deps.set(mod.name, mod.dependsOn);
	}
	for (const mod of modules) {
		for (const dep of mod.dependsOn) {
			if (dep !== "*" && !deps.has(dep)) {
				return err(
					makeError(
						"CDX-E105",
						`module "${mod.name}" depends on unknown module "${dep}"`,
						"Point dependsOn at a module the architecture map declares, then retry.",
					),
				);
			}
		}
	}
	const names = modules.map((mod) => mod.name);
	const cycle = findModuleCycle(names, deps, (dep) => dep === "*");
	if (cycle !== undefined) {
		return err(cycleError(cycle));
	}
	return ok(modules);
}
