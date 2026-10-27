// SPEC §10.2: self-test for the shared fake-ports bundle.
import { strict as assert } from "node:assert";
import test from "node:test";
import { createFakePorts } from "./fake-ports.ts";

test("[§10.2] fake ports bundle wires every port to its fake", async () => {
	const bundle = createFakePorts({
		instant: "2026-03-01T00:00:00.000Z",
		env: { CODICTATOR_PROFILE: "strict" },
	});
	assert.equal(bundle.ports.clock, bundle.clock);
	assert.equal(bundle.ports.fs, bundle.fs);
	assert.equal(bundle.ports.proc, bundle.proc);
	assert.equal(bundle.ports.net, bundle.net);
	assert.equal(bundle.ports.git, bundle.git);
	assert.equal(bundle.ports.env, bundle.env);
	assert.equal(bundle.ports.clock.now(), "2026-03-01T00:00:00.000Z");
	assert.equal(bundle.ports.env.get("CODICTATOR_PROFILE"), "strict");
	const clean = await bundle.ports.git.isClean();
	assert.deepEqual(clean, { ok: true, value: true });
});
