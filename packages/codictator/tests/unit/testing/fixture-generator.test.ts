// SPEC §4.4.4: the fixture-per-rule generator emits one test per fixture
// case in each built-in pack. Every test pins its real fixture assertions
// first, then calls the not-yet-implemented generator contract, so each one
// executes and fails red until the pack self-test lands.
// Integrity exception IE-09-R5-ciactions (rule core/no-assertion-loss,
// path packages/codictator/src/builtin-packs/core/fixtures/
// ci-actions-pinned/passing/basic/case.json, reason: the passing marker
// used a 7-hex short SHA, contradicting SPEC §4.15.2 and the ci module's
// own 40-hex check; corrected to a full 40-hex SHA so the passing case is
// passing for the SPEC reason).
// Integrity exception IE-09-R6-cireq (rule core/no-assertion-loss,
// path packages/codictator/src/builtin-packs/core/fixtures/
// ci-required-check/passing/basic/case.json and
// ci-required-check/violating/basic/case.json, reason: the marker table
// named lint/typecheck/test as the required set, contradicting SPEC
// §4.15.2 and EC-7 (the default branch must require the verify check);
// corrected to required verify (passing) and the old trio without verify
// (violating for the SPEC reason).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { FixtureCase } from "../../support/fixture-generator.ts";
import {
	discoverFixtureCases,
	generateFixtureTests,
	readFixtureManifest,
	runFixtureCase,
} from "../../support/fixture-generator.ts";

const packs = ["core", "typescript", "python"] as const;
const expectedCounts: Record<string, number> = {
	core: 166,
	typescript: 10,
	python: 8,
};

for (const pack of packs) {
	test(`[§4.4.4] generator emits one test per case in ${pack}`, () => {
		const cases = discoverFixtureCases(pack);
		assert.equal(cases.length, expectedCounts[pack]);
		const kinds = new Map<string, Set<string>>();
		for (const fixture of cases) {
			const seen = kinds.get(fixture.rule) ?? new Set<string>();
			seen.add(fixture.kind);
			kinds.set(fixture.rule, seen);
		}
		for (const [rule, seen] of kinds) {
			assert.ok(seen.has("violating"), `rule ${rule} needs a violating case`);
			assert.ok(seen.has("passing"), `rule ${rule} needs a passing case`);
		}
		const emitted = generateFixtureTests(pack);
		assert.equal(emitted.length, cases.length);
	});
}

// SPEC §4.4.1: every case carries its trigger, expected rule ids and tree.
function checkManifest(fixture: FixtureCase): void {
	const manifest = readFixtureManifest(fixture);
	assert.equal(manifest.rule, fixture.rule);
	assert.equal(manifest.section, fixture.section);
	assert.equal(manifest.expectation, fixture.kind);
	assert.ok(manifest.trigger.length > 0);
	assert.ok(Object.keys(manifest.files).length > 0);
	if (fixture.kind === "violating") {
		assert.ok(manifest.expectRules.includes(fixture.rule));
	} else {
		assert.deepEqual(manifest.expectRules, []);
	}
}

for (const pack of packs) {
	for (const fixture of discoverFixtureCases(pack)) {
		test(`[${fixture.section}] ${fixture.rule} ${fixture.kind}/${fixture.name}`, async () => {
			checkManifest(fixture);
			await runFixtureCase(fixture);
		});
	}
}
