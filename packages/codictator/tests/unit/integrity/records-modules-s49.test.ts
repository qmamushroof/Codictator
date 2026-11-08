import { strict as assert } from "node:assert";
import test from "node:test";
import {
	checkHistoryAppendOnly as barrelAppendOnly,
	checkHistory as barrelHistory,
	checkHistoryFiles as barrelHistoryFiles,
	deriveHistoryKind as barrelKind,
	parseHistoryEntries,
} from "../../../src/features/records/history.ts";
import {
	addedHistoryEntries,
	checkAddedHistoryEntryCount,
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	checkHistoryEntryCount,
	entryFinding,
} from "../../../src/features/records/history-checks.ts";
import {
	deriveHistoryKind,
	checkHistory as scopeCheckHistory,
	checkHistoryFiles as scopeCheckHistoryFiles,
} from "../../../src/features/records/history-scope.ts";
import {
	checkHistoryAppendOnly as indexAppendOnly,
	checkHistoryFiles as indexHistoryFiles,
} from "../../../src/features/records/index.ts";

test("[§4.11] records split modules keep their public import shape", () => {
	// SPEC §4.10.3 + §4.11 EC-6/EC-10: the records split keeps checks,
	// scope and parse in their own modules and re-exports them through
	// the history barrel and the records entry, pinned here.
	const fns = [
		entryFinding,
		checkHistoryEntryCount,
		addedHistoryEntries,
		checkAddedHistoryEntryCount,
		checkHistoryEntryComplete,
		checkHistoryAppendOnly,
		deriveHistoryKind,
		scopeCheckHistory,
		scopeCheckHistoryFiles,
		parseHistoryEntries,
	];
	for (const fn of fns) {
		assert.equal(typeof fn, "function");
	}
	assert.equal(barrelAppendOnly, checkHistoryAppendOnly);
	assert.equal(barrelHistory, scopeCheckHistory);
	assert.equal(barrelHistoryFiles, scopeCheckHistoryFiles);
	assert.equal(barrelKind, deriveHistoryKind);
	assert.equal(indexAppendOnly, checkHistoryAppendOnly);
	assert.equal(indexHistoryFiles, scopeCheckHistoryFiles);
});
