// SPEC §4.2.1 step 3 + §4.4.4 (BUG-0110): a configured custom pack loads
// beside the builtins. A missing one fails the load CDX-E203; one whose
// self-test fails at L4, or whose acceptance went stale, loads inert so its
// rules do not run; a healthy one contributes its rules.
import { strict as assert } from "node:assert";
import test from "node:test";
import { loadEvalEnforcers } from "../../../src/cli/evaluate.ts";
import {
	configWithCustom,
	customPackFiles,
	staleAcceptance,
} from "../../support/custom-pack-fixture.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const RULE = "mypack/file-size";

async function loadWith(
	files: Readonly<Record<string, string>>,
	l4: boolean,
): Promise<ReturnType<typeof loadEvalEnforcers>> {
	const fakes = createFakePorts();
	fakes.fs.seedText(".codictator/config.json", configWithCustom());
	for (const [name, text] of Object.entries(files)) {
		fakes.fs.seedText(name, text);
	}
	return loadEvalEnforcers(
		fakes.ports,
		["typescript", "mypack"],
		new Set(),
		l4,
	);
}

test("[§4.2.1] a configured custom pack that is missing fails the load CDX-E203", async () => {
	const loaded = await loadWith({}, false);
	assert.equal(loaded.ok, false);
	if (!loaded.ok) {
		assert.equal(loaded.error.code, "CDX-E203");
		assert.ok(loaded.error.message.includes("mypack"), loaded.error.message);
	}
});

function ruleLoaded(loaded: Awaited<ReturnType<typeof loadWith>>): boolean {
	return (
		loaded.ok && loaded.value.enforcers.some((enforcer) => enforcer.id === RULE)
	);
}

test("[§4.2.1] a custom pack whose self-test fails loads inert at L4 and its rules do not run", async () => {
	const failing = customPackFiles(5);
	// SPEC §4.4.4: L1–L3 gate a custom pack on its acceptance hash only, so
	// the self-test failure surfaces (and the pack goes inert) at L4.
	assert.equal(ruleLoaded(await loadWith(failing, false)), true);
	const l4 = await loadWith(failing, true);
	assert.equal(l4.ok, true);
	if (l4.ok) {
		const ruleIds = l4.value.enforcers.map((enforcer) => enforcer.id);
		assert.equal(ruleIds.includes(RULE), false);
		assert.ok(ruleIds.includes("core/custom-pack-selftest"));
	}
	// SPEC §4.4.8 EC-4: edited after acceptance, inert at L1–L3 too.
	const stale = await loadWith(
		{ ...customPackFiles(320), ...staleAcceptance() },
		false,
	);
	assert.equal(stale.ok, true);
	assert.equal(ruleLoaded(stale), false);
});

test("[§4.4.4] a custom pack that passes its self-test loads its rules", async () => {
	const loaded = await loadWith(customPackFiles(320), true);
	assert.equal(ruleLoaded(loaded), true);
	if (loaded.ok) {
		assert.equal(loaded.value.waiverStore.tiers[RULE], "tunable");
	}
});
