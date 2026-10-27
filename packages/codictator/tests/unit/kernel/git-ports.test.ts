// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.1.1 NodeGit over the scripted FakeProc: no real git,
// no wall-clock waits, every failure maps to CDX-E703.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { ProcResult } from "../../../src/kernel/index.ts";
import { NodeGit } from "../../../src/kernel/index.ts";
import { FakeProc } from "../../support/fake-proc.ts";

function result(overrides: Partial<ProcResult> = {}): ProcResult {
	return {
		code: 0,
		stdout: "",
		stderr: "",
		timedOut: false,
		truncated: false,
		...overrides,
	};
}

function gitWith(handler: (proc: FakeProc) => void): {
	git: NodeGit;
	proc: FakeProc;
} {
	const proc = new FakeProc();
	handler(proc);
	return { git: new NodeGit(proc, "repo"), proc };
}

test("[§4.1] git root trims the toplevel path", async () => {
	const { git, proc } = gitWith((fake) => {
		fake.when(
			["git", "rev-parse", "--show-toplevel"],
			result({ stdout: "repo\n" }),
		);
	});
	const rooted = await git.root();
	assert.equal(rooted.ok, true);
	if (rooted.ok) {
		assert.equal(rooted.value, "repo");
	}
	assert.deepEqual(proc.calls[0]?.argv, [
		"git",
		"rev-parse",
		"--show-toplevel",
	]);
});

test("[§4.1] git root timing out is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "rev-parse", "--show-toplevel"],
			result({ timedOut: true }),
		);
	});
	const rooted = await git.root();
	assert.equal(rooted.ok, false);
	if (!rooted.ok) {
		assert.equal(rooted.error.code, "CDX-E703");
	}
});

test("[§4.1] git root exceeding the size cap is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "rev-parse", "--show-toplevel"],
			result({ truncated: true }),
		);
	});
	const rooted = await git.root();
	assert.equal(rooted.ok, false);
	if (!rooted.ok) {
		assert.equal(rooted.error.code, "CDX-E703");
	}
});

test("[§4.1] git missing from PATH is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "rev-parse", "--show-toplevel"], result({ code: -1 }));
	});
	const rooted = await git.root();
	assert.equal(rooted.ok, false);
	if (!rooted.ok) {
		assert.equal(rooted.error.code, "CDX-E703");
		assert.match(rooted.error.message, /not found on PATH/);
	}
});

test("[§4.1] git head failing is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "rev-parse", "HEAD"], result({ code: 1 }));
	});
	const head = await git.head();
	assert.equal(head.ok, false);
	if (!head.ok) {
		assert.equal(head.error.code, "CDX-E703");
	}
});

test("[§4.1] git head trims the commit hash", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "rev-parse", "HEAD"], result({ stdout: "abc123\n" }));
	});
	const head = await git.head();
	assert.equal(head.ok, true);
	if (head.ok) {
		assert.equal(head.value, "abc123");
	}
});

test("[§4.1] git staged files split and sort", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "diff", "--name-only", "--cached"],
			result({ stdout: "b.ts\na.ts\n\n" }),
		);
	});
	const staged = await git.stagedFiles();
	assert.equal(staged.ok, true);
	if (staged.ok) {
		assert.deepEqual(staged.value, ["a.ts", "b.ts"]);
	}
});

test("[§4.1] git staged files failing is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "diff", "--name-only", "--cached"],
			result({ code: 128 }),
		);
	});
	const staged = await git.stagedFiles();
	assert.equal(staged.ok, false);
	if (!staged.ok) {
		assert.equal(staged.error.code, "CDX-E703");
	}
});

test("[§4.1] git diff returns the patch text", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "diff", "a", "b"], result({ stdout: "patch" }));
	});
	const diff = await git.diff("a", "b");
	assert.equal(diff.ok, true);
	if (diff.ok) {
		assert.equal(diff.value, "patch");
	}
});

test("[§4.1] git diff timing out is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "diff", "a", "b"], result({ timedOut: true }));
	});
	const diff = await git.diff("a", "b");
	assert.equal(diff.ok, false);
	if (!diff.ok) {
		assert.equal(diff.error.code, "CDX-E703");
	}
});

test("[§4.1] git show returns the blob text", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "show", "HEAD:a.ts"], result({ stdout: "text" }));
	});
	const shown = await git.show("HEAD", "a.ts");
	assert.equal(shown.ok, true);
	if (shown.ok) {
		assert.equal(shown.value, "text");
	}
});

test("[§4.1] git show failing is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "show", "HEAD:a.ts"], result({ code: 128 }));
	});
	const shown = await git.show("HEAD", "a.ts");
	assert.equal(shown.ok, false);
	if (!shown.ok) {
		assert.equal(shown.error.code, "CDX-E703");
	}
});

test("[§4.1] git unset config key answers empty", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "config", "--get", "user.name"], result({ code: 1 }));
	});
	const value = await git.config("user.name");
	assert.equal(value.ok, true);
	if (value.ok) {
		assert.equal(value.value, "");
	}
});

test("[§4.1] git config value trims whitespace", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "config", "--get", "user.name"],
			result({ stdout: "ada\n" }),
		);
	});
	const value = await git.config("user.name");
	assert.equal(value.ok, true);
	if (value.ok) {
		assert.equal(value.value, "ada");
	}
});

test("[§4.1] git config timing out is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "config", "--get", "user.name"],
			result({ code: 1, timedOut: true }),
		);
	});
	const value = await git.config("user.name");
	assert.equal(value.ok, false);
	if (!value.ok) {
		assert.equal(value.error.code, "CDX-E703");
	}
});

test("[§4.1] git log returns the fixed-format lines", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "log", "--format=%H %s", "a..b"],
			result({ stdout: "abc subject\n" }),
		);
	});
	const logged = await git.log("a..b");
	assert.equal(logged.ok, true);
	if (logged.ok) {
		assert.equal(logged.value, "abc subject\n");
	}
});

test("[§4.1] git log truncated is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "log", "--format=%H %s", "a..b"],
			result({ truncated: true }),
		);
	});
	const logged = await git.log("a..b");
	assert.equal(logged.ok, false);
	if (!logged.ok) {
		assert.equal(logged.error.code, "CDX-E703");
	}
});

test("[§4.1] git clean tree answers true", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "status", "--porcelain"], result({ stdout: "\n" }));
	});
	const clean = await git.isClean();
	assert.equal(clean.ok, true);
	if (clean.ok) {
		assert.equal(clean.value, true);
	}
});

test("[§4.1] git dirty tree answers false", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "status", "--porcelain"],
			result({ stdout: " M a.ts\n" }),
		);
	});
	const clean = await git.isClean();
	assert.equal(clean.ok, true);
	if (clean.ok) {
		assert.equal(clean.value, false);
	}
});

test("[§4.1] git status failing is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(["git", "status", "--porcelain"], result({ code: 128 }));
	});
	const clean = await git.isClean();
	assert.equal(clean.ok, false);
	if (!clean.ok) {
		assert.equal(clean.error.code, "CDX-E703");
	}
});
