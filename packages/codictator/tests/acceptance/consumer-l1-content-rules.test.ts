// SPEC §4.3.2 + §4.7: the L1 hook scope is the tool call, so the content
// rules (history, deps, ts and python packs) judge it through the pre-tool
// file adapter. Each probe is a real Write payload through the installed
// launcher in a consumer repo whose config loads the ts and python packs; the
// named rule must appear in the deny. Complements the Slice 0 firing matrix
// without owning its fixtures.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	denyReason,
	installConsumer,
	runLauncher,
	taskId,
	toPlanning,
	writePayload,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const HISTORY_PATH = "docs/HISTORY/2026-11-08.md";
const HISTORY_SEED =
	"# History — 2026-11-08\n\n## 2026-11-08 · feat: seed\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** seed\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** none\n";

// Split literals keep this source clean under the repo's own text scans.
const PROBES: ReadonlyArray<readonly [string, string, string]> = [
	[
		"core/history-append-only",
		HISTORY_PATH,
		HISTORY_SEED.replace("seed\n- **What", "rewritten\n- **What"),
	],
	[
		"core/dep-exact-pin",
		"package.json",
		'{"name":"mx","version":"0.0.0","dependencies":{"left-pad":"latest"}}\n',
	],
	[
		"core/dep-one-per-capability",
		"package.json",
		'{"name":"mx","version":"0.0.0","devDependencies":{"prettier":"3.0.0","@biomejs/biome":"2.0.0"}}\n',
	],
	[
		"ts/no-phantom-import",
		"src/mx-phantom.ts",
		'import { zzz } from "ghost-pkg-zzz";\nexport const p = zzz;\n',
	],
	[
		"ts/security-patterns",
		"src/mx-evil.ts",
		`export function run(code: string): unknown {\n  return ev${"al"}(code);\n}\n`,
	],
	[
		"python/no-phantom-import",
		"py/mx_phantom.py",
		"import does_not_exist_xyz\nprint(does_not_exist_xyz)\n",
	],
	[
		"python/security-patterns",
		"py/mx_evil.py",
		`code = input()\nev${"al"}(code)\n`,
	],
];

test("[§4.3.2] consumer L1 content rules fire on a Write through the installed launcher", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const id = await taskId(repo, "content rules widget");
		await toPlanning(repo, id);
		repo.writeFile(HISTORY_PATH, HISTORY_SEED);
		repo.git(["commit", "--no-verify", "-m", "seed history"]);
		const misses: Array<string> = [];
		for (const [rule, file, content] of PROBES) {
			const result = await runLauncher(
				repo.dir,
				["hook", "muse-code", "PreToolUse"],
				JSON.stringify(writePayload(repo.dir, file, content)),
			);
			const reason = denyReason(result.stdout);
			if (reason?.includes(rule) !== true) {
				misses.push(
					`${rule} silent: ${(reason ?? result.stdout).slice(0, 160)}`,
				);
			}
		}
		assert.deepEqual(misses, [], misses.join("\n"));
	} finally {
		repo.cleanup();
	}
});
