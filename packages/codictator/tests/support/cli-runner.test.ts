// SPEC §10.2: self-test for the CLI runner.
import { strict as assert } from "node:assert";
import path from "node:path";
import test from "node:test";
import { builtCliPath, runNodeScript } from "./cli-runner.ts";

test("[§10.2] cli runner captures stdout and exit codes", async () => {
	const ok = await runNodeScript({ nodeArgs: ["-e", "console.log('hi');"] });
	assert.equal(ok.code, 0);
	assert.equal(ok.stdout, "hi\n");
	assert.equal(ok.timedOut, false);
	const failing = await runNodeScript({ nodeArgs: ["-e", "process.exit(3);"] });
	assert.equal(failing.code, 3);
	assert.equal(failing.timedOut, false);
});

test("[§10.2] cli runner pipes stdin to the child", async () => {
	const echoed = await runNodeScript({
		nodeArgs: [
			"-e",
			"let s='';process.stdin.on('data',(c)=>{s+=c;});process.stdin.on('end',()=>{process.stdout.write(s);});",
		],
		stdin: "ping",
	});
	assert.equal(echoed.code, 0);
	assert.equal(echoed.stdout, "ping");
});

test("[§10.2] built cli path resolves under the package dist", () => {
	const parts = builtCliPath().split(path.sep).slice(-3);
	assert.deepEqual(parts, ["dist", "cli", "main.js"]);
});
