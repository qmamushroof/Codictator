// SPEC §4.4: pack loading, composition, self-test, external tools. Owns
// the §7.3 pack.json and §7.4 accepted.json formats.
import type { Result } from "../../kernel/index.ts";
import type { Enforcer } from "../engine/index.ts";

export interface PackRuleParam {
	readonly type: "integer" | "number" | "string[]";
	readonly def: unknown;
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

// SPEC §4.4.3: loading and composition; custom packs need acceptance (§7.4).
export function loadPack(_path: string): Promise<Result<Pack>> {
	throw new Error("not implemented: SPEC §4.4.3");
}

// SPEC §4.4.4: self-test every rule against its fixtures before use.
export function selfTest(_pack: Pack): Promise<Result<void>> {
	throw new Error("not implemented: SPEC §4.4.4");
}
