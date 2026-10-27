// SPEC §10.2: self-test for the scripted Proc support.
import { strict as assert } from "node:assert";
import test from "node:test";
import { FakeProc } from "./fake-proc.ts";

test("[§10.2] fake proc answers scripted argv and records calls", async () => {
	const proc = new FakeProc();
	proc.when(["git", "rev-parse", "HEAD"], {
		code: 0,
		stdout: "abc\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const first = await proc.run(["git", "rev-parse", "HEAD"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 1000,
		maxOutputBytes: 1024,
	});
	assert.equal(first.stdout, "abc\n");
	const second = await proc.run(["git", "status"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 1000,
		maxOutputBytes: 1024,
	});
	assert.equal(second.code, 0);
	assert.equal(proc.calls.length, 2);
	const recorded = proc.calls[0];
	assert.notEqual(recorded, undefined);
	if (recorded === undefined) {
		return;
	}
	assert.deepEqual(recorded.argv, ["git", "rev-parse", "HEAD"]);
});

test("[§10.2] fake proc falls back to the configured missing result", async () => {
	const proc = new FakeProc();
	proc.whenMissing({
		code: 1,
		stdout: "",
		stderr: "nope",
		timedOut: false,
		truncated: false,
	});
	const result = await proc.run(["unknown"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 1000,
		maxOutputBytes: 1024,
	});
	assert.equal(result.code, 1);
	assert.equal(result.stderr, "nope");
});
