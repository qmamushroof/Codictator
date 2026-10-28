// SPEC §3.3 shared vocabulary: the verdict contract (triggers, findings,
// enforcers) and the pack data model (§7.3). Every feature consumes these
// types, so they live in the kernel — the one module §3.3 lets every other
// import — instead of forcing feature-to-feature type imports (SPEC §4.11
// EC-4: type imports are edges). engine/index.ts and packs/index.ts
// re-export them, so existing importers keep working.
export type Instant = string;

export const TRIGGERS = [
	"pre-tool",
	"post-tool",
	"prompt",
	"startup",
	"compact",
	"review",
	"scheduled",
] as const;

export type Trigger = (typeof TRIGGERS)[number];

export interface CheckContext {
	readonly trigger: Trigger;
	readonly scope: Scope;
	readonly now: Instant;
	readonly configHash: string;
}

export interface Scope {
	readonly files: ReadonlyArray<string>;
	readonly sessionId?: string;
}

export interface Finding {
	readonly ruleId: string;
	readonly path?: string;
	readonly line?: number;
	readonly code?: string;
	readonly message: string;
	readonly remediation: string;
}

export type Decision = "allow" | "advise" | "block" | "escalate";

// SPEC §3.4: rules are data; enforcers plug in through the registry so the
// engine never grows per family. The enforcer carries the rule's identity
// (id), its triggers (kinds) and its check; scope globs and params arrive
// with the pack rule model (phase 5).
export interface Enforcer {
	readonly id: string;
	readonly kinds: ReadonlyArray<Trigger>;
	readonly budgetMs: number;
	readonly check: (
		ctx: CheckContext,
		params: Readonly<Record<string, unknown>>,
	) => Promise<Array<Finding>>;
}

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

// SPEC §3.4: rule data binding enforcers.
export interface Pack {
	readonly manifest: PackManifest;
	readonly enforcers: ReadonlyArray<Enforcer>;
	readonly drivers: ReadonlyArray<unknown>;
	readonly assets: ReadonlyArray<unknown>;
}
