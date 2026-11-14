// SPEC §4.7.3 + BUG-0100: a write: target holding code characters is judged, so
// a full-tree verify blocks `../../etc/x=>y` in a workflow. Driven through the
// real CLI entry over a temp git repo.
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

test("[§4.7.3] verify at the local gate blocks a workflow write: target that escapes with => (BUG-0100)", async () => {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		repo.writeFile("plan.yml", "steps:\n  write: ../../etc/x=>y\n");
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
		const hits = (body.findings ?? []).filter(
			(finding) => finding.ruleId === "core/write-confinement",
		);
		assert.equal(hits.length, 1);
	} finally {
		repo.cleanup();
	}
});
