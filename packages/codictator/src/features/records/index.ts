// SPEC §4.9: doc checks, history, bug registry. Owns the §7.7 record
// grammars. The checks are pure over caller-supplied trees; ports stay at
// the enforcer layer (SPEC §3.3).

export {
	type BugFile,
	type BugRow,
	type BugStatus,
	checkBugRegistry,
	checkBugRowsImmutable,
	checkBugs,
	checkDiagnoseBeforeFix,
	parseBugFile,
	type TaskRef,
} from "./bugs.ts";
export {
	checkDocBreadth,
	checkDocDensity,
	checkDocLinksValid,
	checkDocNoCorpusCounts,
	checkDocNoInlineChangelog,
	checkDocOneLevel,
	checkDocPlacement,
	checkDocRouterLeaf,
	checkDocSingleOwner,
	checkDocSize,
	checkDocs,
	classifyDoc,
	DEFAULT_DOC_LIMITS,
	type DocClass,
	type DocFile,
	type DocLimits,
	githubSlug,
	type RouterLeaf,
	type RouterTree,
	splitSentences,
} from "./docs.ts";
export {
	checkHistory,
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	checkHistoryEntryCount,
	checkHistoryFiles,
	deriveHistoryKind,
	type HistoryEntry,
	type HistoryKind,
	type HistoryParse,
	parseHistoryEntries,
} from "./history.ts";
