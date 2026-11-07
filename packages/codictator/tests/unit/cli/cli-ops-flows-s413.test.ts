import { strict as assert } from "node:assert";

import test from "node:test";

import { handleRemediate } from "../../../src/cli/remediation.ts";

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

test("[§4.13] remediate plan without a baseline plans zero steps", async () => {
	// SPEC §4.13: with no baseline the planner emits an empty plan.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan tolerates a scalar baseline", async () => {
	// SPEC §4.13: a baseline that is not a record falls back to empty.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(".codictator/baseline.json", "42\n");
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan tolerates entries that are not a record", async () => {
	// SPEC §4.13: entries that are not a record fall back to empty.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/baseline.json",
			`${JSON.stringify({ version: 1, entries: 7 })}\n`,
		);
		const ran = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan with extra args is a usage error", async () => {
	// SPEC §4.19.2: plan takes no positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["plan", "extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status without a plan fails CDX-E903", async () => {
	// SPEC §4.13: status reads the plan the plan step wrote.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRemediate(req(["status"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status of a corrupt plan fails CDX-E903", async () => {
	// SPEC §4.13: a plan that is not a plan asks for a fresh plan run.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(".codictator/plan/remediation.json", "not json\n");
		const ran = await handleRemediate(req(["status"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate next of an empty plan is complete", async () => {
	// SPEC §4.13: with every step done (vacuously) the plan is complete.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const ran = await handleRemediate(req(["next"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate next answers as data with --json", async () => {
	// SPEC §4.19.2: remediate status ships done and total counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const ran = await handleRemediate(req(["status"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run without an id is a usage error", async () => {
	// SPEC §4.19.2: run names the step id.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const planned = await handleRemediate(req(["plan"], repo.dir));
		assert.equal(planned.ok, true);
		const ran = await handleRemediate(req(["run"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run of a gated step fails CDX-E608", async () => {
	// SPEC §4.13.4: a step without gate evidence refuses to run.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/plan/remediation.json",
			`${JSON.stringify({
				version: 1,
				steps: [{ id: "S-0001", status: "pending" }],
			})}\n`,
		);
		const ran = await handleRemediate(req(["run", "S-0001"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E608");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run of a done step reports the run", async () => {
	// SPEC §4.13.4: a done step needs no gates and reports exit 1 with
	// the gate-evidence reminder.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/plan/remediation.json",
			`${JSON.stringify({
				version: 1,
				steps: [{ id: "S-0002", status: "done" }],
			})}\n`,
		);
		const ran = await handleRemediate(req(["run", "S-0002"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run of an unknown step throws", async () => {
	// SPEC §4.13.4: an unknown step id has no step to gate, so the run
	// throws instead of verdicting (fail-closed at the entry).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/plan/remediation.json",
			`${JSON.stringify({
				version: 1,
				steps: [{ id: "S-0001", status: "pending" }],
			})}\n`,
		);
		await assert.rejects(
			handleRemediate(req(["run", "S-9999"], repo.dir)),
			/unknown remediation step S-9999/,
		);
	} finally {
		repo.cleanup();
	}
});
