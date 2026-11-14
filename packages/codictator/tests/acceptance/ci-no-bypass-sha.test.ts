// SPEC §4.14.2 core/no-bypass at L4 + BUG-0090: the trailer finding of each
// commit in a multi-commit range names its sha with no leading newline.
// Driven through the real CLI entry over a temp git repo.
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

test("[§4.14.2] ci verify names every untrailered commit by a clean sha (BUG-0090)", async () => {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		repo.writeFile("src/a.ts", "export const a = 1;\n");
		repo.commit("feat(app): add a");
		repo.writeFile("src/b.ts", "export const b = 2;\n");
		repo.commit("feat(app): add b");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const mainUrl = new URL("../../src/cli/main.ts", import.meta.url).href;
		const argv = ["--json", "ci", "verify", "--base", base, "--head", head];
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
		assert.ok(parsed.ok, `ci verify printed no JSON: ${ran.stderr}`);
		const body = parsed.value as {
			findings?: Array<{ ruleId: string; message: string }>;
		};
		const bypass = (body.findings ?? []).filter(
			(finding) => finding.ruleId === "core/no-bypass",
		);
		assert.equal(bypass.length, 2);
		for (const finding of bypass) {
			assert.match(finding.message, /^commit [0-9a-f]{40} lacks /);
		}
	} finally {
		repo.cleanup();
	}
});
