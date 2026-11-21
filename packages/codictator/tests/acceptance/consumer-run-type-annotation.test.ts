// BUG-0115 (SPEC §4.7.3): a consumer source file holding a TypeScript
// parameter annotated `run: Record<string, unknown>,` draws no
// core/write-confinement finding; a workflow run: redirect still does.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	installConsumer,
	srcMain,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

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

const NL = String.fromCharCode(10);
const SOURCE = [
	"export function runStep(",
	"\trun: Record<string, unknown>,",
	"\tflag: unknown,",
	"): void {}",
	"export const shape = {",
	"\trun: unknown,",
	"};",
	"",
].join(NL);

test("[consumer] [§4.7.3] a source run: type annotation draws no write-confinement finding (BUG-0115)", async () => {
	const out = await stagedOutput([["src/probe.ts", SOURCE]]);
	assert.ok(!out.includes("core/write-confinement"), out);
	assert.ok(!out.includes("core/dangerous-shell"), out);
});

test("[consumer] [§4.7.3] a workflow run: redirect to a comma target still draws a finding (BUG-0115)", async () => {
	const out = await stagedOutput([
		[
			".github/workflows/probe.yml",
			"name: probe\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi > ../../etc/x,\n",
		],
	]);
	assert.ok(out.includes("core/write-confinement"), out);
});
