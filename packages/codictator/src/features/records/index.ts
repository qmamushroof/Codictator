// SPEC §4.9: doc checks, history, bug registry. Owns the §7.7 record
// grammars. The checks are pure over caller-supplied trees; ports stay at
// the enforcer layer (SPEC §3.3).

export {
	type BugFile,
	type BugRow,
	type BugStatus,
	parseBugFile,
} from "./bug-grammar.ts";
export {
	checkBugRegistry,
	checkDiagnoseBeforeFix,
	type TaskRef,
} from "./bug-registry.ts";
export { checkBugRowsImmutable } from "./bug-rows-immutable.ts";
export { checkBugs } from "./bugs.ts";
export {
	checkDocNoInlineChangelog,
	checkDocOneLevel,
	checkDocPlacement,
	checkDocSingleOwner,
	checkDocs,
	classifyDoc,
	type DocClass,
} from "./docs.ts";
export {
	checkDocDensity,
	checkDocLinksValid,
	checkDocNoCorpusCounts,
	githubSlug,
	splitSentences,
} from "./docs-prose.ts";
export {
	checkDocBreadth,
	checkDocRouterLeaf,
	checkDocSize,
	DEFAULT_DOC_LIMITS,
	type DocFile,
	type DocLimits,
	type RouterLeaf,
	type RouterTree,
} from "./docs-structure.ts";
export {
	checkHistory,
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	checkHistoryEntryCount,
	addedHistoryEntries,
	checkAddedHistoryEntryCount,
	checkHistoryFiles,
	deriveHistoryKind,
	type HistoryEntry,
	type HistoryKind,
	type HistoryParse,
	parseHistoryEntries,
} from "./history.ts";
