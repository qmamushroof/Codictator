// SPEC §4.10.2 + §4.12: red/green proofs and task lifecycle remainders.
// In-process handler calls: assertions read the returned Result, never
// stdout (the runner shares process.stdout with TAP).
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { handleTestCmd } from "../../../src/cli/proofs-test.ts";
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

async function newTask(cwd: string): Promise<void> {
	const made = await handleTask(
		req(["new", "--type", "feature", "--title", "proof target"], cwd),
	);
	assert.equal(made.ok, true);
}

test("[§4.10] test rejects an unknown kind", async () => {
	// SPEC §4.19.2: test records red or green proofs only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTestCmd(
			req(["bogus", "--task", "T-0001", "t"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.10] test red without titles is a usage error", async () => {
	// SPEC §4.10.2: the declared tests must be listed on the command.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTestCmd(req(["red", "--task", "T-0001"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.10] test red for an unknown task fails CDX-E903", async () => {
	// SPEC §4.10.2: proofs attach to an existing task record.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTestCmd(
			req(["red", "--task", "T-0001", "some test"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.10] test red without a commit fails CDX-E703", async () => {
	// SPEC §4.10.2: the proof binds HEAD, so a commit must exist.
	const repo = createTempRepo();
	try {
		await newTask(repo.dir);
		const ran = await handleTestCmd(
			req(["red", "--task", "T-0001", "some test"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.10] test red records the failing titles", async () => {
	// SPEC §4.10.2: the red proof binds HEAD, tree and failing titles.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		await newTask(repo.dir);
		const ran = await handleTestCmd(
			req(["red", "--task", "T-0001", "some test"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
		const task = await readTask(repo.dir, "T-0001");
		assert.deepEqual(task?.redProof?.failing, ["some test"]);
	} finally {
		repo.cleanup();
	}
});

test("[§4.10] test green records the tree", async () => {
	// SPEC §4.10.2: the green proof binds the tree the suite passed on.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		await newTask(repo.dir);
		const ran = await handleTestCmd(
			req(["green", "--task", "T-0001", "some test"], repo.dir),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
		const task = await readTask(repo.dir, "T-0001");
		assert.ok((task?.greenProof?.tree ?? "").length > 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.10] test outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: proofs resolve the task root before reading anything.
	const plain = mkdtempSync(path.join(tmpdir(), "codictator-noproof-"));
	try {
		const ran = await handleTestCmd(
			req(["red", "--task", "T-0001", "some test"], plain),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});

test("[§4.12] task new with a positional is a usage error", async () => {
	// SPEC §4.19.2: new takes only --type and --title flags.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTask(req(["new", "extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task new with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable flags are usage errors, never throws.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTask(req(["new", "--type"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task new on a detached HEAD fails CDX-E903", async () => {
	// SPEC §4.12: creation binds the branch; without one it fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.git(["checkout", "--detach", "HEAD"]);
		const ran = await handleTask(
			req(["new", "--type", "feature", "--title", "branchless"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task checkpoint with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable checkpoint flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTask(req(["checkpoint", "--id"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task checkpoint answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the checkpoint marker for the extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		await newTask(repo.dir);
		const ran = await handleTask(
			req(["checkpoint", "--id", "T-0001"], repo.dir, true),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task amend with a title rewrites the line", async () => {
	// SPEC §4.12: amend replaces the title while keeping the record.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		await newTask(repo.dir);
		const ran = await handleTask(
			req(["amend", "--id", "T-0001", "--title", "renamed"], repo.dir),
		);
		assert.equal(ran.ok, true);
		const task = await readTask(repo.dir, "T-0001");
		assert.equal(task?.title, "renamed");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task amend with a type rewrites the line", async () => {
	// SPEC §4.12: amend replaces the type while keeping the record.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		await newTask(repo.dir);
		const ran = await handleTask(
			req(["amend", "--id", "T-0001", "--type", "fix"], repo.dir),
		);
		assert.equal(ran.ok, true);
		const task = await readTask(repo.dir, "T-0001");
		assert.equal(task?.type, "fix");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task ack for an unknown id fails CDX-E903", async () => {
	// SPEC §4.12: mutation reads the record before the human-only gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTask(
			req(["ack", "--id", "T-0001", "--note", "n"], repo.dir),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task phase next with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable phase flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleTask(req(["phase", "next", "--id"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});
