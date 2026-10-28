// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.7.2 parser boundaries (||, |&, ;, &), groupings,
// stray closers, fd-drop redirections and every handleRedirection target
// shape (quoted, heredoc, herestring, input, append, empty) through
// analyseShell, plus prefix-strip branches reached through the same driver.
import { strict as assert } from "node:assert";
import test from "node:test";
import { analyseShell } from "../../../src/kernel/index.ts";

function pipelinesOf(command: string) {
	const parsed = analyseShell(command);
	assert.ok(parsed.ok, `expected ${command} to parse`);
	if (!parsed.ok) {
		throw new Error("unreachable");
	}
	return parsed.value;
}

test("[§4.7.2] shell boundaries split on or pipe-merge and token kinds", () => {
	assert.equal(pipelinesOf("false || true").pipelines.length, 2);
	const merged = pipelinesOf("echo a |& cat");
	assert.equal(merged.pipelines.length, 1);
	assert.deepEqual(
		merged.pipelines[0]?.commands.map((command) => command.name),
		["echo", "cat"],
	);
	assert.equal(pipelinesOf("echo a; echo b").pipelines.length, 2);
	assert.equal(pipelinesOf("echo a & echo b").pipelines.length, 2);
	assert.equal(pipelinesOf("echo a\n echo b").pipelines.length, 2);
});

test("[§4.7.2] shell groupings descend and stray closers fail CDX-E306", () => {
	assert.equal(pipelinesOf("(echo hi)").pipelines.length, 1);
	assert.equal(pipelinesOf("{ echo hi; }").pipelines.length, 1);
	assert.ok(pipelinesOf("echo (hi)").pipelines.length >= 1);
	const stray = analyseShell("echo hi )");
	assert.ok(!stray.ok);
	if (!stray.ok) {
		assert.equal(stray.error.code, "CDX-E306");
	}
	const brace = analyseShell("}");
	assert.ok(!brace.ok);
	if (!brace.ok) {
		assert.equal(brace.error.code, "CDX-E306");
	}
});

test("[§4.7.2] shell redirections drop fds and record quoted targets", () => {
	const dropped = pipelinesOf("echo hi 2> out.txt");
	assert.deepEqual(dropped.pipelines[0]?.commands[0]?.argv, ["hi"]);
	assert.deepEqual(dropped.writeTargets, ["out.txt"]);
	const quoted = pipelinesOf('echo hi > "out file.txt"');
	assert.deepEqual(quoted.writeTargets, ["out file.txt"]);
	const appended = pipelinesOf("echo hi >> out.txt");
	assert.deepEqual(appended.writeTargets, ["out.txt"]);
	const input = pipelinesOf("cat < in.txt");
	assert.deepEqual(input.inputs, ["in.txt"]);
	const quotedInput = pipelinesOf('grep x < "in file.txt"');
	assert.deepEqual(quotedInput.inputs, ["in file.txt"]);
	const heredoc = pipelinesOf("cat << EOF\nbody\nEOF\n");
	assert.equal(heredoc.pipelines.length, 1);
	assert.deepEqual(heredoc.writeTargets, []);
	const strip = pipelinesOf("cat <<- EOF\n\tbody\nEOF\n");
	assert.equal(strip.pipelines.length, 1);
	const string = pipelinesOf("cat <<< hello");
	assert.equal(string.pipelines.length, 1);
	assert.deepEqual(string.writeTargets, []);
	assert.deepEqual(string.inputs, []);
});

test("[§4.7.2] shell redirections without a target fail CDX-E306", () => {
	for (const command of ["echo hi >", "echo hi > ", 'echo hi > ""']) {
		const parsed = analyseShell(command);
		assert.ok(!parsed.ok, `expected ${command} to fail`);
		if (!parsed.ok) {
			assert.equal(parsed.error.code, "CDX-E306");
		}
	}
});

test("[§4.7.2] shell prefixes strip through the parser driver", () => {
	const sudo = pipelinesOf("sudo -- ls");
	assert.equal(sudo.pipelines[0]?.commands[0]?.name, "ls");
	assert.equal(sudo.pipelines[0]?.commands[0]?.elevated, true);
	assert.equal(pipelinesOf("sudo").pipelines.length, 0);
	assert.equal(pipelinesOf("-n hello").pipelines.length, 0);
	const timed = pipelinesOf("time ls");
	assert.equal(timed.pipelines[0]?.commands[0]?.name, "ls");
});
