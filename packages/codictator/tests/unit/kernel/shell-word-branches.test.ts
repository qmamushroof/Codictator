// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.7.2 word-scanner branches: backtick descent inside
// double quotes (descendQuoted), quote-aware extent scans with nested $()
// and parens, and the in-loop heredoc terminator throw. Pure string
// processing with a recording descend callback; no I/O.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	readShellBalanced,
	readShellHeredoc,
	readShellQuoted,
	readShellWord,
} from "../../../src/kernel/shell-word.ts";

test("[§4.7.2] shell double quotes descend into backticks", () => {
	const seen: Array<string> = [];
	const read = readShellQuoted('"a`b`c"', 0, (inner) => seen.push(inner));
	assert.deepEqual(seen, ["b"]);
	assert.equal(read.value, "abc");
	assert.equal(read.next, 7);
});

test("[§4.7.2] shell double quotes fail on unclosed backticks", () => {
	assert.throws(() => readShellQuoted('"a`bc', 0, () => {}));
	assert.throws(() => readShellQuoted('"a`b`c', 0, () => {}));
});

test("[§4.7.2] shell balanced scans respect quotes and nesting", () => {
	assert.equal(readShellBalanced('"a)b" c)', 0, ")").value, '"a)b" c');
	assert.equal(readShellBalanced("'a)b' c)", 0, ")").value, "'a)b' c");
	assert.equal(readShellBalanced("$(a) b)", 0, ")").value, "$(a) b");
	assert.equal(readShellBalanced("(a) b)", 0, ")").value, "(a) b");
	assert.equal(readShellBalanced('"a\\"b" c)', 0, ")").value, '"a\\"b" c');
});

test("[§4.7.2] shell heredocs fail when the body ends without a delimiter", () => {
	assert.throws(() => readShellHeredoc("\nbody", 0, "EOF", false));
	assert.throws(() => readShellHeredoc("x\nbody", 0, "EOF", false));
});

test("[§4.7.2] shell double quotes skip escapes inside backticks", () => {
	const seen: Array<string> = [];
	const read = readShellQuoted('"a`b\\`c`d"', 0, (inner) => seen.push(inner));
	assert.deepEqual(seen, ["b\\`c"]);
	assert.equal(read.value, "ab\\`cd");
});

test("[§4.7.2] shell words keep escapes and fail on a trailing backslash", () => {
	const noop = (): void => {};
	assert.equal(readShellWord("a\\\n b", 0, noop).value, "a");
	assert.equal(readShellWord("a\\ b c", 0, noop).value, "a b");
	assert.throws(() => readShellWord("a\\", 0, noop));
});
