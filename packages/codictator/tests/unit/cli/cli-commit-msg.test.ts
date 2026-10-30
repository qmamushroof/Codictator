// SPEC §4.14.4: the commit-msg hook appends the Codictator-L3 trailer to
// the COMMIT_EDITMSG file git hands it. Git passes an absolute path, and in
// a linked worktree that file lives under the main repo's
// .git/worktrees/<name>/ dir, outside the worktree root, so the confined Fs
// port (CDX-E701 on absolute paths) can never touch it: the hook reads and
// writes it with kernel-owned host I/O and blocks fail-closed when the file
// is unreadable.
import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { handleGitHook } from "../../../src/cli/git-hook.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
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

function seedConfig(repo: {
	writeFile: (rel: string, content: string) => void;
}): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

test("[§4.14.4] commit-msg appends the trailer to an absolute message path", async () => {
	// SPEC §4.14.2: the hook appends the Codictator-L3 trailer. Git always
	// passes an absolute COMMIT_EDITMSG path, which the confined Fs port
	// rejects (CDX-E701), so this failed before the host-I/O fix.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		const msgFile = path.join(repo.dir, "COMMIT_EDITMSG");
		writeFileSync(msgFile, "subject line\n", "utf8");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		assert.match(readFileSync(msgFile, "utf8"), /^Codictator-L3: /m);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14.4] commit-msg appends the trailer outside the repo root", async () => {
	// SPEC §4.14.4: in a linked worktree the message file lives under the
	// main repo's .git/worktrees/<name>/ dir, outside the worktree root.
	// The hook must still trailer it instead of blocking CDX-E701.
	const repo = createTempRepo();
	const outside = mkdtempSync(path.join(tmpdir(), "codictator-msg-"));
	try {
		seedConfig(repo);
		const msgFile = path.join(outside, "COMMIT_EDITMSG");
		writeFileSync(msgFile, "linked worktree subject\n", "utf8");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		assert.match(readFileSync(msgFile, "utf8"), /^Codictator-L3: /m);
	} finally {
		repo.cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
});

test("[§4.14.4] commit-msg leaves an already-trailered message alone", async () => {
	// SPEC §4.14.2: a message that already carries the trailer is not
	// double-stamped.
	const repo = createTempRepo();
	const outside = mkdtempSync(path.join(tmpdir(), "codictator-msg-"));
	try {
		seedConfig(repo);
		const msgFile = path.join(outside, "COMMIT_EDITMSG");
		writeFileSync(msgFile, "subject\n\nCodictator-L3: abc123abc123\n", "utf8");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		const seen = readFileSync(msgFile, "utf8").match(/^Codictator-L3: /gm);
		assert.equal(seen?.length, 1);
	} finally {
		repo.cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
});

test("[§4.14.4] commit-msg with an unwritable message file blocks", async () => {
	// Fail-closed: an unwritable message file blocks CDX-E903, never a
	// silent allow.
	const repo = createTempRepo();
	const outside = mkdtempSync(path.join(tmpdir(), "codictator-msg-"));
	const msgFile = path.join(outside, "COMMIT_EDITMSG");
	try {
		seedConfig(repo);
		writeFileSync(msgFile, "subject\n", "utf8");
		chmodSync(msgFile, 0o444);
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		try {
			chmodSync(msgFile, 0o666);
		} catch {
			// Cleanup best-effort so rmSync can remove the read-only file.
		}
		repo.cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
});
test("[§4.14.4] commit-msg with an unreadable message file blocks", async () => {
	// Fail-closed (PRD §12 #12): a missing message file is an error, never
	// a silent allow.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		const missing = path.join(repo.dir, "does-not-exist-COMMIT_EDITMSG");
		const ran = await handleGitHook(req(["commit-msg", missing], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});
