// SPEC §4.4: pack loading, composition, self-test, external tools. Owns
// the §7.3 pack.json and §7.4 accepted.json formats.
import type { Enforcer } from "../engine/index.ts";

export interface PackRuleParam {
	readonly type: "integer" | "number" | "string[]";
	// SPEC §7.3: the pack default; self-test (§4.4.4 EC) checks it sits
	// within bound along the stricter direction.
	readonly default: unknown;
	readonly bound: unknown;
	readonly stricter: "lower" | "higher" | "subset" | "superset" | "policy";
	readonly min?: number;
	readonly max?: number;
}

export interface PackRule {
	readonly id: string;
	readonly family: string;
	readonly tier: string;
	readonly statement: string;
	readonly reason: string;
	readonly remediation: string;
	readonly enforcer: string;
	readonly triggers: ReadonlyArray<string>;
	readonly scope: ReadonlyArray<string>;
	readonly params: Readonly<Record<string, PackRuleParam>>;
	readonly ratchet?: unknown;
	readonly measureVersion: number;
	readonly fixtures: {
		readonly violating: ReadonlyArray<string>;
		readonly passing: ReadonlyArray<string>;
	};
}

export interface PackManifest {
	readonly id: string;
	readonly version: string;
	readonly description: string;
	readonly rules: ReadonlyArray<PackRule>;
	readonly enforcers: ReadonlyArray<unknown>;
	readonly drivers: ReadonlyArray<unknown>;
	readonly extractors: ReadonlyArray<unknown>;
	readonly measures: ReadonlyArray<unknown>;
	readonly capabilities: ReadonlyArray<unknown>;
	readonly assets: ReadonlyArray<unknown>;
	readonly maxWaiverDays: number;
}

export interface PackAccepted {
	readonly version: 1;
	readonly packHash: string;
	readonly selfTestHash: string;
	readonly acceptedAt: string;
	readonly acceptedBy: string;
}

// SPEC §3.4: rule data binding enforcers.
export interface Pack {
	readonly manifest: PackManifest;
	readonly enforcers: ReadonlyArray<Enforcer>;
	readonly drivers: ReadonlyArray<unknown>;
	readonly assets: ReadonlyArray<unknown>;
}

export type { AcceptPackOptions } from "./accept.ts";
export { acceptPack } from "./accept.ts";
export { resolveCodeEnforcer } from "./enforcers/code.ts";
export {
	type ExternalArgs,
	type ExternalInput,
	type ExternalOptions,
	isExternalInput,
	type ToolDecl,
	type ToolEvent,
	type ToolVersion,
} from "./enforcers/external.ts";
export {
	narrowExternalArgs,
	narrowToolDecl,
} from "./enforcers/external-bind.ts";
export { resolveExternal } from "./enforcers/external-check.ts";
export { digestArgv, planRuns, safePath } from "./enforcers/external-runs.ts";
export { isParametricKind, resolveParametric } from "./enforcers/parametric.ts";
export { packHashFor, selfTestHashFor } from "./hashes.ts";
export type { LoadPackOptions } from "./loader.ts";
export { composePacks, loadBuiltinPack, loadPack } from "./loader.ts";
export { resolvePackEnforcers } from "./registry.ts";
// SPEC §4.4.4: self-test every rule against its fixtures before use.
export { selfTest } from "./selftest.ts";
