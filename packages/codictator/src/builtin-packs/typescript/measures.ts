// SPEC §6.1 measures: re-export surface split by responsibility —
// function-size and cyclomatic spans in measures-functions.ts, exported-name
// and dead-export scans in measures-exports.ts.

export { findDeadExports, findExportedNames } from "./measures-exports.ts";
export type { FunctionSpan } from "./measures-functions.ts";
export {
	measureCyclomatic,
	measureFunctionSizes,
} from "./measures-functions.ts";
