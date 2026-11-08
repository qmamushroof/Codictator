// SPEC §4.7.1 + §4.9.4: git history reads fail closed over faked proc.
// runGitText maps every proc failure to CDX-E703; the BUGS fallback keeps
// staged files when git is unavailable and merges tracked extras otherwise.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	checkStagedHistory,
	runGitText,
	withTrackedBugsFallback,
} from "../../../src/cli/git-history.ts";
import type { CommandPorts } from "../../../src/cli/shared.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function commandPorts(): { ports: CommandPorts } {
	const fake = createFakePorts();
	return { ports: { ...fake.ports, root: "/repo" } };
}

function failingPorts(): {
	ports: CommandPorts;
} {
	const fake = createFakePorts();
	fake.proc.whenMissing({
		code: 1,
		stdout: "",
		stderr: "fatal: not a git repository",
		timedOut: false,
		truncated: false,
	});
	return { ports: { ...fake.ports, root: "/repo" } };
}

test("[§4.7] runGitText resolves the git stdout on a zero exit", async () => {
	const fake = createFakePorts();
	fake.proc.when(["git", "log", "--oneline"], {
		code: 0,
		stdout: "abc first\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const seen = await runGitText({ ...fake.ports, root: "/repo" }, [
		"git",
		"log",
		"--oneline",
	]);
	assert.equal(seen.ok, true);
	if (!seen.ok) {
		return;
	}
	assert.equal(seen.value, "abc first\n");
});

test("[§4.7] runGitText fails closed with CDX-E703 on a nonzero exit", async () => {
	const { ports } = failingPorts();
	const seen = await runGitText(ports, ["git", "log", "--oneline"]);
	assert.equal(seen.ok, false);
	if (seen.ok) {
		return;
	}
	assert.equal(seen.error.code, "CDX-E703");
});

test("[§4.7] runGitText fails closed with CDX-E703 on a proc timeout", async () => {
	const fake = createFakePorts();
	fake.proc.whenHang(["git", "log", "--oneline"]);
	const seen = await runGitText({ ...fake.ports, root: "/repo" }, [
		"git",
		"log",
		"--oneline",
	]);
	assert.equal(seen.ok, false);
	if (seen.ok) {
		return;
	}
	assert.equal(seen.error.code, "CDX-E703");
});

test("[§4.9] tracked BUGS fallback keeps staged BUGS files without git", async () => {
	const { ports } = commandPorts();
	const files = ["docs/BUGS/2026.md", "src/a.ts"];
	const seen = await withTrackedBugsFallback(ports, files);
	assert.deepEqual(seen, files);
});

test("[§4.9] tracked BUGS fallback keeps staged files when git fails", async () => {
	const { ports } = failingPorts();
	const seen = await withTrackedBugsFallback(ports, ["src/a.ts"]);
	assert.deepEqual(seen, ["src/a.ts"]);
});

test("[§4.9] tracked BUGS fallback merges tracked extras without dupes", async () => {
	const fake = createFakePorts();
	fake.proc.when(
		["git", "ls-tree", "HEAD", "--name-only", "--", "docs/BUGS/"],
		{
			code: 0,
			stdout: "docs/BUGS/2026.md\ndocs/BUGS/2027.md\n",
			stderr: "",
			timedOut: false,
			truncated: false,
		},
	);
	const seen = await withTrackedBugsFallback({ ...fake.ports, root: "/repo" }, [
		"src/a.ts",
	]);
	assert.deepEqual(seen, [
		"src/a.ts",
		"docs/BUGS/2026.md",
		"docs/BUGS/2027.md",
	]);
});

test("[§4.9] staged history check stays quiet without a history file", async () => {
	const { ports } = commandPorts();
	const seen = await checkStagedHistory(
		ports,
		["src/a.ts"],
		"2026-01-01T00:00:00.000Z",
		"hash",
	);
	assert.deepEqual(seen, []);
});

test("[§4.9] staged history check stays quiet when the staged read fails", async () => {
	const { ports } = failingPorts();
	const seen = await checkStagedHistory(
		ports,
		["docs/HISTORY/2026-10-05.md"],
		"2026-01-01T00:00:00.000Z",
		"hash",
	);
	assert.deepEqual(seen, []);
});

test("[§4.9] staged history check judges staged text without a HEAD base", async () => {
	const fake = createFakePorts();
	const historyPath = "docs/HISTORY/2026-10-05.md";
	fake.proc.when(["git", "show", `:${historyPath}`], {
		code: 0,
		stdout:
			"# History — 2026-10-05\n\n## 2026-10-05 · feature: do a thing\n\n- **Kind:** fix\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** flaw\n- **Trade-offs:** none\n- **Lessons:** learned\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	fake.proc.whenMissing({
		code: 1,
		stdout: "",
		stderr: "path does not exist",
		timedOut: false,
		truncated: false,
	});
	const seen = await checkStagedHistory(
		{ ...fake.ports, root: "/repo" },
		[historyPath],
		"2026-10-05T00:00:00.000Z",
		"hash",
	);
	assert.ok(Array.isArray(seen));
});
