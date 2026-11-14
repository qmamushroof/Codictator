// SPEC §6.1 ts/lint + BUG-0091: a regex literal holding a quote never hides
// the later use of a binding. Driven through the real CLI entry over a temp
// git repo with the typescript pack, at the review layer.
import { strict as assert } from "node:assert";
import test from "node:test";
import { parseJson } from "../../src/kernel/index.ts";
import { runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const CONFIG = {
	version: 1,
	codictator: "unknown",
	packs: [{ id: "typescript" }],
	harnesses: ["opencode"],
};
const DQ = String.fromCharCode(34);

test("[§6.1] ci layer ts/lint flags only the genuinely unused binding beside a regex literal (BUG-0091)", async () => {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		repo.writeFile(
			"src/a.ts",
			`const unused = 1;\nconst later = 2;\nexport const ok = /x${DQ}/.test(${DQ}s${DQ}) && later > 0;\n`,
		);
		repo.git(["add", "-A"]);
		const mainUrl = new URL("../../src/cli/main.ts", import.meta.url).href;
		const argv = ["--json", "verify", "--all", "--layer", "L4"];
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
		const body = parsed.value as {
			findings?: Array<{ ruleId: string; message: string }>;
		};
		const lint = (body.findings ?? [])
			.filter((finding) => finding.ruleId === "ts/lint")
			.map((finding) => finding.message);
		assert.deepEqual(lint, ["unused binding unused in src/a.ts:1"]);
	} finally {
		repo.cleanup();
	}
});
