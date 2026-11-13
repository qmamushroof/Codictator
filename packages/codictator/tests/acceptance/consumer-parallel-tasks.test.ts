// SPEC §4.12.1/§4.12.3: a branch's active task is the task every hook on
// that branch judges. A parallel task on another branch whose files.allow
// claims the same file must not block the active task's planned write
// (BUG-0075: the gates judged every claiming task, so parallel tasks
// sharing choke files mutually blocked).
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	denyReason,
	installConsumer,
	runLauncher,
	srcMain,
	taskId,
	toPlanning,
	writePayload,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[§4.12.3] consumer task writes its planned src file while a parallel task claims it", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		repo.git(["checkout", "-b", "feature/parallel-a"]);
		const parallel = await taskId(repo, "parallel widget");
		await toPlanning(repo, parallel);
		repo.git(["checkout", "-b", "feature/active-b"]);
		const active = await taskId(repo, "active widget");
		await toPlanning(repo, active);
		const red = await srcMain(
			["test", "red", "--task", active, "[§4.12] widget"],
			repo.dir,
		);
		assert.equal(red.code, 0, `test red failed: ${red.stdout}${red.stderr}`);
		const next = await srcMain(
			["task", "phase", "next", "--id", active],
			repo.dir,
		);
		assert.equal(next.code, 0, `phase next failed: ${next.stdout}`);
		const write = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(
				writePayload(repo.dir, "src/widget.ts", "export const w = 1;\n"),
			),
		);
		assert.equal(write.code, 0, `hook failed: ${write.stderr}`);
		const reason = denyReason(write.stdout);
		assert.equal(
			reason,
			undefined,
			`the active task's planned write was denied (parallel ${parallel}): ${reason}`,
		);
	} finally {
		repo.cleanup();
	}
});
