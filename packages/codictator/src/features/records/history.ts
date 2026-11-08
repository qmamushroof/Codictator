// SPEC §4.9.3: history barrel path; parsing lives in history-parse.ts,
// entry checks in history-checks.ts, kind and scope in history-scope.ts.
export {
	addedHistoryEntries,
	checkAddedHistoryEntryCount,
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	checkHistoryEntryCount,
} from "./history-checks.ts";
export {
	type HistoryEntry,
	type HistoryKind,
	type HistoryParse,
	parseHistoryEntries,
} from "./history-parse.ts";
export {
	checkHistory,
	checkHistoryFiles,
	deriveHistoryKind,
} from "./history-scope.ts";
