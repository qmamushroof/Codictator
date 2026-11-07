// SPEC §4.18 + BUG-0055: git hooks append verdict events. `pre-commit`
// evaluates the staged change and lands the auditable verdict (layer L3)
// in `.codictator/state/events.jsonl`, so commit blocks reach the Timeline.
// Before the fix the hook returned its verdict only on stdout and the log
// stayed empty.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleGitHook } from "../../../src/cli/git-hook.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { ENGINE_VERSION } from "../../../src/features/config/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function req(args: ReadonlyArray<string>, cwd: string): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function fieldOf(row: Record<string, unknown>, name: string): unknown {
	return row[name];
}

test("[§4.18] pre-commit appends its verdict event to the log", async () => {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: ENGINE_VERSION,
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	});
	try {
		repo.writeFile("hello.txt", "hello world\n");
		await handleGitHook(req(["pre-commit"], repo.dir));
		const logPath = path.join(repo.dir, ".codictator", "state", "events.jsonl");
		assert.equal(existsSync(logPath), true);
		const lines = readFileSync(logPath, "utf8")
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const verdicts = lines.filter(
			(line) => fieldOf(line, "kind") === "verdict",
		);
		assert.ok(verdicts.length > 0);
		assert.ok(
			verdicts.some(
				(line) =>
					fieldOf(line, "layer") === "L3" &&
					fieldOf(line, "trigger") === "review",
			),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] pre-commit tags its verdict with the branch task", async () => {
	// SPEC §4.12.1: the branch task is the active task, so the hook verdict
	// carries its id. The task record binds the temp repo's own branch.
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: ENGINE_VERSION,
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	});
	try {
		const branch = repo.git(["branch", "--show-current"]).trim();
		repo.writeFile(
			".codictator/tasks/T-0007.json",
			JSON.stringify({
				version: 1,
				id: "T-0007",
				type: "fix",
				title: "branch work",
				branch,
				phase: "implementation",
				phases: [],
				spec: [],
				acceptanceCriteria: [],
				files: { allow: [] },
			}),
		);
		repo.writeFile("hello.txt", "hello world\n");
		await handleGitHook(req(["pre-commit"], repo.dir));
		const lines = readFileSync(
			path.join(repo.dir, ".codictator", "state", "events.jsonl"),
			"utf8",
		)
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const verdicts = lines.filter(
			(line) => fieldOf(line, "kind") === "verdict",
		);
		assert.ok(verdicts.some((line) => fieldOf(line, "taskId") === "T-0007"));
	} finally {
		repo.cleanup();
	}
});
