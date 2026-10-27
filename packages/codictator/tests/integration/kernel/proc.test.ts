// SPEC §4.1.1, §4.1.3 EC-5, EC-6 and §9.2: integration tests for the real
// Proc port against the real OS. Children are the current Node binary via an
// argv array with shell:false; nothing reaches the network and every temp dir
// is removed afterwards.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProcEnv, NodeProc } from "../../../src/kernel/index.ts";

const proc = new NodeProc();

test("[§4.1.1] successful run returns the exit code and output", async () => {
	const result = await proc.run([process.execPath, "-p", "40 + 2"], {
		cwd: tmpdir(),
		env: {},
		timeoutMs: 30000,
		maxOutputBytes: 65536,
	});
	assert.equal(result.code, 0);
	assert.equal(result.stdout.trim(), "42");
	assert.equal(result.timedOut, false);
	assert.equal(result.truncated, false);
});

test("[§4.1 EC-5] child output past maxOutputBytes is killed and truncated", async () => {
	const result = await proc.run(
		[process.execPath, "-e", "process.stdout.write('x'.repeat(200000))"],
		{
			cwd: tmpdir(),
			env: {},
			timeoutMs: 30000,
			maxOutputBytes: 4096,
		},
	);
	assert.equal(result.truncated, true);
	assert.ok(result.stdout.length <= 4096);
});

test("[§4.1 EC-6] child ignoring SIGTERM is tree-killed within budget", {
	timeout: 30000,
}, async (t) => {
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-proc-"));
	t.after(() => {
		rmSync(dir, { recursive: true, force: true });
	});
	const pidFile = path.join(dir, "grandchild.pid");
	// SPEC §4.1.3 EC-6: the parent ignores SIGTERM and the grandchild
	// shares its process group, so only the escalation kill ends both.
	const parentScript = [
		"const {spawn}=require('node:child_process');",
		"const fs=require('node:fs');",
		"process.on('SIGTERM',()=>{});",
		"const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
		"fs.writeFileSync(process.argv[1],String(g.pid));",
		"setInterval(()=>{},1000);",
	].join("");
	const result = await proc.run(
		[process.execPath, "-e", parentScript, pidFile],
		{
			cwd: tmpdir(),
			env: {},
			timeoutMs: 2000,
			maxOutputBytes: 65536,
		},
	);
	assert.equal(result.timedOut, true);
	const grandchild = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
	assert.ok(Number.isSafeInteger(grandchild));
	let alive = true;
	try {
		process.kill(grandchild, 0);
	} catch {
		alive = false;
	}
	if (alive) {
		try {
			process.kill(grandchild, "SIGKILL");
		} catch {
			// Already gone; the assertion below reports the outcome.
		}
	}
	assert.equal(alive, false);
});

test("[§4.1.1] stdin reaches the child and stderr is captured", async () => {
	const result = await proc.run(
		[
			process.execPath,
			"-e",
			"process.stdin.on('data',(d)=>{process.stdout.write(d);process.stderr.write('err-'+d)});",
		],
		{
			cwd: tmpdir(),
			env: {},
			stdin: "hi",
			timeoutMs: 30000,
			maxOutputBytes: 65536,
		},
	);
	assert.equal(result.code, 0);
	assert.equal(result.stdout, "hi");
	assert.equal(result.stderr, "err-hi");
});

test("[§4.1.1] missing executable resolves without throwing", async () => {
	const result = await proc.run(["codictator-definitely-missing-binary"], {
		cwd: tmpdir(),
		env: {},
		timeoutMs: 30000,
		maxOutputBytes: 65536,
	});
	assert.equal(result.code, -1);
	assert.equal(result.timedOut, false);
	assert.equal(result.truncated, false);
});
test("[§9.2] child env keeps the allowlist and drops the rest", () => {
	const child = buildProcEnv({
		PATH: "/x",
		FOO: "bar",
		GITHUB_TOKEN: "token",
		CI: "",
	});
	const { PATH: childPath } = child;
	assert.equal(childPath, "/x");
	assert.equal("FOO" in child, false);
	assert.equal("GITHUB_TOKEN" in child, false);
	const ciChild = buildProcEnv({ CI: "1", GITHUB_TOKEN: "token" });
	const { GITHUB_TOKEN: ciToken } = ciChild;
	assert.equal(ciToken, "token");
	assert.equal("FOO" in ciChild, false);
});

test("[§9.2] spawned child never sees unlisted variables", async () => {
	const result = await proc.run(
		[process.execPath, "-p", "process.env.CDX_PROBE ?? 'absent'"],
		{
			cwd: tmpdir(),
			env: { CDX_PROBE: "s3cr3t", CI: "" },
			timeoutMs: 30000,
			maxOutputBytes: 65536,
		},
	);
	assert.equal(result.code, 0);
	assert.equal(result.stdout.trim(), "absent");
});
