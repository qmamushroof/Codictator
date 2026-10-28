// SPEC §4.18.2 + §4.18.6 EC-4/EC-5: branch coverage for the explain
// lookup (errorRowFor, explainCodeText, nearest ids, CDX-E010 text) the
// red ledger does not pin. Pure over the code table: deterministic.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	errorRowFor,
	explain,
	explainCodeText,
	explainUnknownText,
	isKnownExplainId,
	nearestExplainIds,
} from "../../../src/features/audit/index.ts";

test("[§4.18.2] errorRowFor answers the §8 row or undefined", () => {
	// SPEC §4.18.2: known codes resolve with their §8.2 exit; unknown
	// codes resolve to undefined for the CDX-E010 path.
	const found = errorRowFor("CDX-E101");
	assert.ok(found !== undefined);
	assert.equal(found.exit, 3);
	assert.equal(errorRowFor("CDX-E999"), undefined);
});

test("[§4.18.2] isKnownExplainId separates rows from unknown ids", () => {
	// SPEC §4.18.2: the CLI answers known ids directly and maps the
	// rest to the CDX-E010 unknown-id path (exit 2).
	assert.equal(isKnownExplainId("CDX-E503"), true);
	assert.equal(isKnownExplainId("core/no-secrets"), false);
});

test("[§4.18.2] explainCodeText leads with the greppable code", () => {
	// SPEC §4.18.2: the code leads so the row is greppable, the §8.2
	// exit tells the caller the bucket, and the remediation follows.
	const found = errorRowFor("CDX-E503");
	assert.ok(found !== undefined);
	const text = explainCodeText(found);
	assert.ok(text.startsWith("CDX-E503: "));
	assert.ok(text.includes("(exit 5)"));
	assert.ok(text.includes("Do instead: "));
	assert.ok(text.includes("SPEC §8.1 row CDX-E503"));
});

test("[§4.18.6 EC-4] nearest ids surface the replay row for replay queries", () => {
	// SPEC §4.18.6 EC-4: word overlap ranks CDX-E011 first for a
	// replay-flavoured id; CDX-E010 never ranks itself.
	const nearest = nearestExplainIds("evt-replay-old-pack");
	assert.equal(nearest[0], "CDX-E011");
	assert.ok(!nearest.includes("CDX-E010"));
});

test("[§4.18.6 EC-4] nearest ids are deterministic and honour the limit", () => {
	// SPEC §4.18.6 EC-4: ties break by code, so the ranking is stable
	// across calls; the limit caps the list.
	const first = nearestExplainIds("some-query", 2);
	const second = nearestExplainIds("some-query", 2);
	assert.deepEqual(first, second);
	assert.equal(first.length, 2);
});

test("[§4.18.6 EC-4] nearest ids fall back to code order on no overlap", () => {
	// SPEC §4.18.6 EC-4: with zero word overlap every score ties, so
	// the first three codes in order win.
	assert.deepEqual(nearestExplainIds("zzz-qqq"), [
		"CDX-E001",
		"CDX-E002",
		"CDX-E003",
	]);
});

test("[§4.18.6 EC-4] unknown-id text names the replay remediation", () => {
	// SPEC §4.18.6 EC-4 (and EC-5 when the query names a replay):
	// CDX-E010 with the nearest known ids, each with its one-line row.
	const text = explainUnknownText("evt-replay-old-pack");
	assert.ok(
		text.includes(
			'CDX-E010: unknown rule, event or error id "evt-replay-old-pack"',
		),
	);
	assert.ok(text.includes("Nearest known ids:"));
	assert.ok(text.includes("- CDX-E011: "));
	assert.ok(text.includes("Do instead for replays: "));
});

test("[§4.18.6 EC-4] unknown-id text without replay names no replay row", () => {
	// SPEC §4.18.6 EC-4: a query with no replay overlap lists the
	// code-ordered neighbours and no replay remediation.
	const text = explainUnknownText("zzz-qqq");
	assert.ok(text.includes("CDX-E010"));
	assert.ok(text.includes("- CDX-E001: "));
	assert.ok(!text.includes("Do instead for replays: "));
});

test("[§4.18.2] explain answers known codes and unknown ids", async () => {
	// SPEC §4.18.2: a known code resolves to its §8 row; anything else
	// resolves to the CDX-E010 text with the nearest known ids.
	const known = await explain("CDX-E101");
	assert.ok(known.includes("CDX-E101"));
	const unknown = await explain("no-such-thing");
	assert.ok(unknown.includes("CDX-E010"));
});
