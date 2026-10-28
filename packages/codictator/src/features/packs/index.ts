// SPEC §4.4: pack loading, composition, self-test, external tools. Owns
// the §7.3 pack.json and §7.4 accepted.json formats.

// The pack data model (§7.3) lives in the kernel shared vocabulary so
// builtin packs need no packs-module edge for types alone (SPEC §4.11
// EC-4); re-exported here so existing importers keep working.
export type {
	Pack,
	PackManifest,
	PackRule,
	PackRuleParam,
} from "../../kernel/index.ts";

export interface PackAccepted {
	readonly version: 1;
	readonly packHash: string;
	readonly selfTestHash: string;
	readonly acceptedAt: string;
	readonly acceptedBy: string;
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
