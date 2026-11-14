// SPEC §4.7.2 + §4.7.3 + BUG-0094: source lines that open with `write:` or
// `run:` as object syntax are code, so a full-tree verify at the local gate
// reports neither core/write-confinement nor core/dangerous-shell. Driven
// through the real CLI entry over a temp git repo.
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

const SOURCE = [
	"export const handlers = {",
	"\twrite: (",
	"\t\tpath: string,",
	"\t) => path,",
	"\trun: (",
	"\t\tcommand: string,",
	"\t) => command,",
	"};",
	"",
].join("\n");

test("[§4.7.3] verify at the local gate ignores write: and run: arrow properties in source (BUG-0094)", async () => {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		repo.writeFile("src/handlers.ts", SOURCE);
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
		const hits = (body.findings ?? [])
			.map((finding) => finding.ruleId)
			.filter(
				(id) =>
					id === "core/write-confinement" || id === "core/dangerous-shell",
			);
		assert.deepEqual(hits, []);
	} finally {
		repo.cleanup();
	}
});
