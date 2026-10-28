// SPEC §4.12.4: review rounds over the findings file. Submit validates
// the file and verdicts it; resolve reports the still-open blockers and
// majors. Rounds bind the staged tree and the reviewer session on the
// task record. In-process handler calls: assertions read the returned
// Result, never stdout (the runner shares process.stdout with TAP).
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { handleReview } from "../../../src/cli/proofs.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { handleTask } from "../../../src/cli/task-advance.ts";
import { readTask } from "../../../src/cli/tasks.ts";
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

function findingsFile(shape: unknown): string {
	return `${JSON.stringify(shape)}\n`;
}

test("[§4.12] review rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside submit/resolve is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReview(
			req(["bogus", "--file", "f.json"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit without a file is a usage error", async () => {
	// SPEC §4.19.2: submit needs --file; a missing value is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReview(req(["submit"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with a positional is a usage error", async () => {
	// SPEC §4.19.2: positionals are refused before any file is read.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReview(
			req(["submit", "--file", "f.json", "extra"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review of a missing findings file fails CDX-E607", async () => {
	// SPEC §4.12.4: an unreadable findings file fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReview(
			req(["submit", "--file", "nope.json"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E607");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review of a non-JSON findings file fails CDX-E607", async () => {
	// SPEC §4.12.4: a findings file that is not JSON fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile("findings.json", "not json\n");
		const ran = await handleReview(
			req(["submit", "--file", "findings.json"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E607");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review of a shapeless findings file fails CDX-E607", async () => {
	// SPEC §4.12.4: findings must be a list under version 1.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile("findings.json", findingsFile({ version: 1 }));
		const ran = await handleReview(
			req(["submit", "--file", "findings.json"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E607");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit of a clean round passes", async () => {
	// SPEC §4.12.4: a bound round with no findings submits clean.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			findingsFile({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await handleReview(
			req(["submit", "--file", "findings.json"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit answers as data with --json", async () => {
	// SPEC §4.18.3: the verdict ships the file, finding count and blockers.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			findingsFile({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await handleReview(
			req(["submit", "--file", "findings.json"], repo.dir, true),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with a task records the round", async () => {
	// SPEC §4.12.4: a passing submit on a task appends the review round.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const made = await handleTask(
			req(["new", "--type", "feature", "--title", "round trip"], repo.dir),
		);
		assert.equal(made.ok, true);
		repo.writeFile(
			"findings.json",
			findingsFile({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await handleReview(
			req(["submit", "--file", "findings.json", "--task", "T-0001"], repo.dir),
		);
		assert.equal(ran.ok, true);
		const task = await readTask(repo.dir, "T-0001");
		assert.equal(task?.reviews?.length, 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with blockers stays open", async () => {
	// SPEC §4.12.4: open blocker/major findings exit 1 with no round recorded.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			findingsFile({
				version: 1,
				findings: [
					{ id: "F-1", severity: "blocker", path: "a.ts", message: "bad" },
				],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await handleReview(
			req(["submit", "--file", "findings.json"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review resolve of a clean round is clean", async () => {
	// SPEC §4.12.4: resolve with no open findings reports clean.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			findingsFile({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await handleReview(
			req(["resolve", "--file", "findings.json"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review reads an absolute findings path", async () => {
	// SPEC §4.12.4: absolute --file paths resolve against the repo root.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			findingsFile({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const absolute = `${repo.dir}/findings.json`;
		const ran = await handleReview(
			req(["submit", "--file", absolute], repo.dir),
		);
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: review resolves the repo root before reading anything.
	const plain = mkdtempSync(path.join(tmpdir(), "codictator-noreview-"));
	try {
		const ran = await handleReview(req(["submit", "--file", "f.json"], plain));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});
