import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { needCommandContext } from "../../../src/cli/command-context.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

function req(cwd: string): CommandRequest {
	return {
		args: [],
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

test("[§4.19] needCommandContext resolves root, ports and clock time", async () => {
	// SPEC §4.19: the shared preamble answers root, live ports and now once.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const resolved = await needCommandContext(req(repo.dir));
		assert.equal("ok" in resolved, false);
		if ("ok" in resolved) {
			return;
		}
		assert.equal(typeof resolved.root, "string");
		assert.equal(typeof resolved.now, "string");
		assert.ok(resolved.now.length > 0);
		assert.equal(typeof resolved.ports.clock.now(), "string");
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] needCommandContext fails closed outside a repo", async () => {
	// SPEC §4.19: without a repo root the preamble answers the needRoot
	// failure instead of throwing.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-no-repo-"));
	try {
		const resolved = await needCommandContext(req(dir));
		assert.equal("ok" in resolved, true);
		if (!("ok" in resolved) || resolved.ok) {
			assert.fail("expected a needRoot failure result");
		}
		assert.equal(resolved.error.code, "CDX-E703");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
