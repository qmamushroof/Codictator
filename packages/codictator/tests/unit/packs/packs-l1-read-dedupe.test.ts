// SPEC §4.6.5: a live L1 read is judged on the hook entry's read-cache
// evidence, not only fixture marker reports (BUG-0106). The scope names each
// target the session already holds unchanged; the rule blocks it with the
// call number of the earlier read.
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveReadDedupe } from "../../../src/features/packs/enforcers/steering-guards.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import {
	checked,
	ctxFor,
	DECL,
	portsWith,
	readScope,
	ruleFor,
} from "../../support/pre-tool-scenario.ts";

async function check(scope = readScope("src/a.ts")) {
	const enforcer = checked(
		resolveReadDedupe(
			DECL,
			ruleFor("core/read-dedupe"),
			portsWith(new FakeFs()),
		),
	);
	return enforcer.check(ctxFor(scope), {});
}

test("[§4.6.5] L1 read-dedupe blocks a read the session already holds unchanged", async () => {
	const found = await check({
		...readScope("src/a.ts"),
		repeatReads: [{ path: "src/a.ts", call: 2 }],
	});
	assert.equal(found.length, 1);
	assert.equal(found[0]?.ruleId, "core/read-dedupe");
	assert.equal(found[0]?.path, "src/a.ts");
	assert.match(found[0]?.message ?? "", /already in context since call 2/);
});

test("[§4.6.5] L1 read-dedupe stays quiet on a first read", async () => {
	assert.deepEqual(await check(), []);
});
