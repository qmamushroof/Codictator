// BUG-0112 (SPEC §4.7.2, §4.7.3): a consumer repo whose workflow redirects to
// /dev/null or duplicates a descriptor, and whose source holds a `{ run: … }`
// object literal, draws no core/write-confinement or core/dangerous-shell
// finding; a real `../` escape and a flow-mapping run: in a workflow still do.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	installConsumer,
	srcMain,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const SHELL_RULES = ["core/write-confinement", "core/dangerous-shell"];

async function stagedOutput(
	files: ReadonlyArray<readonly [string, string]>,
): Promise<string> {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		for (const [file, text] of files) {
			writeTreeFile(repo, file, text);
		}
		repo.git(["add", ...files.map(([file]) => file)]);
		const run = await srcMain(["verify", "--staged"], repo.dir);
		return `${run.stdout}${run.stderr}`;
	} finally {
		repo.cleanup();
	}
}

const WORKFLOW = ".github/workflows/probe.yml";
const STEPS = (run: string): string =>
	`name: probe\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;

test("[consumer] [§4.7.3] fd duplications, null devices and a source run: object draw no shell finding (BUG-0112)", async () => {
	const out = await stagedOutput([
		[WORKFLOW, STEPS("make 2>&1 >/dev/null; echo hi >&2; make 2> NUL")],
		[
			"src/probe.ts",
			"export const step = { isTty: () => true, run: () => 1 };\n",
		],
	]);
	for (const rule of SHELL_RULES) {
		assert.ok(!out.includes(rule), `${rule} fired:\n${out}`);
	}
});

test("[consumer] [§4.7.3] a ../ escape and a workflow flow-mapping run: still draw a shell finding (BUG-0112)", async () => {
	const outside = await stagedOutput([
		[WORKFLOW, STEPS("make >/dev/null 2>&1 > ../../etc/x")],
	]);
	assert.ok(outside.includes("core/write-confinement"), outside);
	const flow = await stagedOutput([
		[
			WORKFLOW,
			"name: probe\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - { name: x, run: echo hi }\n",
		],
	]);
	assert.ok(
		SHELL_RULES.some((rule) => flow.includes(rule)),
		flow,
	);
});
