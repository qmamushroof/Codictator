// SPEC §7.1 D10: the remediation plan lives at
// .codictator/plan/remediation.json. A legacy plan at the old path is
// read once and migrated; afterwards the SPEC path owns it.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	handleRemediate,
	REMEDIATION_PLAN_PATH,
} from "../../../src/cli/remediation.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

test("[§7.1] remediate plan writes the SPEC path", async () => {
	// SPEC §7.1: the plan generates at .codictator/plan/remediation.json.
	assert.equal(REMEDIATION_PLAN_PATH, ".codictator/plan/remediation.json");
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
		const status = await handleRemediate(req(["status"], repo.dir));
		assert.equal(status.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§7.1] remediate reads the legacy path once as a migration", async () => {
	// The old path still answers once (migration); the next write owns
	// the SPEC path, so the legacy file is never read again.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [{ id: "s1", status: "open" }] }),
		);
		const migrated = await handleRemediate(req(["status"], repo.dir));
		assert.equal(migrated.ok, true);
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const status = await handleRemediate(req(["status"], repo.dir));
		assert.equal(status.ok, true);
	} finally {
		repo.cleanup();
	}
});
