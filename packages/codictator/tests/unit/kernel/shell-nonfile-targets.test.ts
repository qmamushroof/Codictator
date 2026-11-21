// SPEC §4.7.3 + BUG-0112: a file-descriptor duplication redirect and a
// redirect to a null device are not write targets; real files still are.
import { strict as assert } from "node:assert";
import test from "node:test";
import { analyseShell } from "../../../src/kernel/index.ts";

function targetsOf(command: string): ReadonlyArray<string> {
	const parsed = analyseShell(command);
	assert.ok(parsed.ok, `expected ${command} to parse`);
	if (!parsed.ok) {
		throw new Error("unreachable");
	}
	return parsed.value.writeTargets;
}

test("[§4.7.3] a file-descriptor duplication redirect is not a write target (BUG-0112)", () => {
	for (const command of [
		"make 2>&1",
		"echo hi >&2",
		"exec 3>&-",
		"cmd 1>&2",
		"cmd 2>&1 | tee",
	]) {
		const targets = targetsOf(command);
		assert.ok(
			!targets.some((target) => /^(\d+|-)$/.test(target)),
			`${command} judged ${JSON.stringify(targets)}`,
		);
	}
	assert.deepEqual(targetsOf("make 2>&1"), []);
	assert.deepEqual(targetsOf("echo hi >&2"), []);
	assert.deepEqual(targetsOf("exec 3>&-"), []);
});

test("[§4.7.3] a duplication redirect drops its fd word from the argv (BUG-0112)", () => {
	const parsed = analyseShell("echo hi 2>&1");
	assert.ok(parsed.ok);
	if (parsed.ok) {
		assert.deepEqual(parsed.value.pipelines[0]?.commands[0]?.argv, ["hi"]);
	}
});

test("[§4.7.3] a redirect to a file stays a write target beside a duplication (BUG-0112)", () => {
	assert.deepEqual(targetsOf("make > out.txt 2>&1"), ["out.txt"]);
	assert.deepEqual(targetsOf("make >& out.txt"), ["out.txt"]);
	assert.deepEqual(targetsOf("make &> out.txt"), ["out.txt"]);
	assert.deepEqual(targetsOf("make >&../../etc/x"), ["../../etc/x"]);
});

test("[§4.7.3] a redirect to /dev/null or NUL is not a write target (BUG-0112)", () => {
	for (const command of [
		"make > /dev/null",
		"make >/dev/null 2>&1",
		"make 2>/dev/null",
		"make &> /dev/null",
		"make >> /dev/null",
		"make > NUL",
		"make 2> NUL",
	]) {
		assert.deepEqual(targetsOf(command), [], command);
	}
});

test("[§4.7.3] a lookalike of a null device stays a write target (BUG-0112)", () => {
	assert.deepEqual(targetsOf("make > /dev/nullx"), ["/dev/nullx"]);
	assert.deepEqual(targetsOf("make > /dev/sda"), ["/dev/sda"]);
	assert.deepEqual(targetsOf("make > ../NUL"), ["../NUL"]);
});
