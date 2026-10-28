// Shared evaluation inputs for the §4.8.5 verdict path: manifests plus the
// caller-supplied snapshot, lockfiles, bot files and registries. Absent data
// means "not supplied", never "clean".
import type { Finding } from "../engine/index.ts";
import type { RegistrySnapshot } from "./index.ts";
import type { NpmDepKind } from "./npm.ts";
import type { DepLagParams } from "./stable.ts";

export interface EvalDep {
	readonly name: string;
	readonly range: string;
	readonly kind: NpmDepKind;
}

export interface EvalManifest {
	readonly path: string;
	readonly dependencies: ReadonlyArray<EvalDep>;
}

export interface DepEvalInput {
	readonly manifests: ReadonlyArray<EvalManifest>;
	readonly snapshot?: RegistrySnapshot;
	readonly now: string;
	readonly params?: Partial<DepLagParams>;
	readonly licenseAllow?: ReadonlyArray<string>;
	readonly lockfiles?: Readonly<Record<string, string | null>>;
	readonly npmrc?: { readonly path: string; readonly text: string };
	readonly allowedRegistryHosts?: ReadonlyArray<string>;
	readonly newDeps?: ReadonlyArray<string>;
	readonly addedReasons?: Readonly<Record<string, boolean>>;
	readonly unpublished?: ReadonlyArray<string>;
	readonly saveExactRequired?: boolean;
}

export interface DepEvaluation {
	readonly findings: ReadonlyArray<Finding>;
	readonly notes: ReadonlyArray<string>;
}

export interface UniqueDep {
	readonly path: string;
	readonly dep: EvalDep;
}

// SPEC §4.8.8 EC-10: a workspace monorepo judges each manifest separately
// but counts a package once.
export function uniqueDeps(
	manifests: ReadonlyArray<EvalManifest>,
): ReadonlyArray<UniqueDep> {
	const seen = new Set<string>();
	const out: Array<UniqueDep> = [];
	for (const manifest of manifests) {
		for (const dep of manifest.dependencies) {
			if (seen.has(dep.name)) {
				continue;
			}
			seen.add(dep.name);
			out.push({ path: manifest.path, dep });
		}
	}
	return out;
}

export function pinFinding(path: string, name: string, range: string): Finding {
	return {
		ruleId: "core/dep-exact-pin",
		path,
		message: `${name}@${range} in ${path} is not an exact pin`,
		remediation: `Pin ${name} to an exact version in ${path}.`,
	};
}
