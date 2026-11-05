import { strict as assert } from "node:assert";

import test from "node:test";

import { LOG_REL } from "../../../src/features/audit/append.ts";

import { readEvents } from "../../../src/features/audit/read.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

const ROOT = "repo";

const LOG = `${ROOT}/${LOG_REL}`;

test("[§4.18] blank lines are skipped while corrupt lines count", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "\n\nnot json\n");
	const read = await readEvents(bundle.ports, ROOT);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.equal(read.value.events.length, 0);
		assert.equal(read.value.corrupt, 1);
	}
});
