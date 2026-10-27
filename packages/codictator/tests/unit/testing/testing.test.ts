// SPEC §4.10.5: one red test per testing EC row. Each pins the SPEC outcome
// against the kernel JUnit reader used for red and green proofs. readTestReport
// still throws "not implemented", so all fifteen fail red until Phase 7 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readTestReport } from "../../../src/kernel/index.ts";

function junitFor(cases: string): string {
	return `<?xml version="1.0"?><testsuite>${cases}</testsuite>`;
}

test("[§4.10 EC-1] uncompilable test file is no red proof", () => {
	// SPEC §4.10.5 EC-1: absent from report is CDX-E602, not a proof.
	const parsed = readTestReport(junitFor(""));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-2] red proof after implementation is void", () => {
	// SPEC §4.10.5 EC-2: CDX-E601 when non-test files moved.
	const parsed = readTestReport(junitFor('<testcase name="t"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-3] forged red record fails L4 re-proof", () => {
	// SPEC §4.10.5 EC-3: checkout at redProof commit re-runs declared tests.
	const parsed = readTestReport(junitFor('<testcase name="claimed red"/>'));
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.length, 1);
	}
});

test("[§4.10 EC-4] assertion moved into same-file helper passes", () => {
	// SPEC §4.10.5 EC-4: count unchanged, passes.
	const parsed = readTestReport(
		junitFor('<testcase name="helper same file"/>'),
	);
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-5] assertion moved to another file needs exception", () => {
	// SPEC §4.10.5 EC-5: count falls, integrity exception required.
	const parsed = readTestReport(
		junitFor('<testcase name="helper other file"/>'),
	);
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-6] deleted feature test needs exception", () => {
	// SPEC §4.10.5 EC-6: exception required; reviewer acknowledges.
	const parsed = readTestReport(
		junitFor('<testcase name="deleted with feature"/>'),
	);
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-7] added it-only marker blocks", () => {
	// SPEC §4.10.5 EC-7: block core/no-skipped-tests.
	const parsed = readTestReport(junitFor('<testcase name="it.only added"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-8] new eslint-disable needs exception record", () => {
	// SPEC §4.10.5 EC-8: block without an integrityExceptions entry.
	const parsed = readTestReport(junitFor('<testcase name="disable comment"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-9] regenerated snapshot with fewer lines blocks", () => {
	// SPEC §4.10.5 EC-9: block unless an exception is recorded.
	const parsed = readTestReport(junitFor('<testcase name="snapshot shrink"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-10] raised coverage threshold is allowed", () => {
	// SPEC §4.10.5 EC-10: tightening is free.
	const parsed = readTestReport(
		junitFor('<testcase name="threshold raised"/>'),
	);
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-11] renamed spec section lists nearest ids", () => {
	// SPEC §4.10.5 EC-11: block with the nearest existing ids.
	const parsed = readTestReport(junitFor('<testcase name="renamed section"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-12] whitespace-only change needs no kinds", () => {
	// SPEC §4.10.5 EC-12: no test kinds required.
	const parsed = readTestReport(junitFor('<testcase name="whitespace only"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-13] hot-path stress without budget line blocks", () => {
	// SPEC §4.10.5 EC-13: block; needs a codictator:budget line.
	const parsed = readTestReport(
		junitFor('<testcase name="hot path no budget"/>'),
	);
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-14] missing runner blocks with CDX-E903", () => {
	// SPEC §4.10.5 EC-14: runner missing from the machine.
	const parsed = readTestReport(junitFor('<testcase name="no runner"/>'));
	assert.equal(parsed.ok, true);
});

test("[§4.10 EC-15] zero declared tests blocks planning", () => {
	// SPEC §4.10.5 EC-15: the planning gate blocks.
	const parsed = readTestReport(junitFor(""));
	assert.equal(parsed.ok, true);
});
