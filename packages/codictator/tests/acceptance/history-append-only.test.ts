// SPEC §4.9.3 + §4.9.5 EC-8: history stays append-only through the real gate.
// A staged in-place edit of a committed history entry blocks `git
// pre-commit` on the built CLI with core/history-append-only, while a
// fresh entry prepended on top passes. Pins the T-0005 stacked-gates fix:
// the added-entry count gate no longer masks append-only on in-place edits.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { type CliResult, runBuiltCli } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

const TITLE = "# History — 2026-10-05\n\n";
const ENTRY =
	"## 2026-10-05 · feature: do a thing\n\n- **Kind:** code\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** learned\n";
const BASE = `${TITLE}${ENTRY}`;
const NEXT =
	"## 2026-10-06 · feature: do another thing\n\n- **Kind:** docs\n- **Task:** T-0002\n- **Why:** reason\n- **Docs:** none\n";

function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..");
}

function seed(repo: TempRepo): void {
	const manifest = JSON.parse(
		readFileSync(path.join(packageRoot(), "package.json"), "utf8"),
	) as { version: string };
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: manifest.version,
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
	repo.writeFile("docs/HISTORY/2026-10-05.md", BASE);
	repo.commit("history fixture");
}

function precommit(repo: TempRepo): Promise<CliResult> {
	return runBuiltCli({
		args: ["git", "pre-commit"],
		cwd: repo.dir,
		timeoutMs: 120_000,
	});
}

test("[§4.9 EC-8] staged fresh history entry passes pre-commit", async () => {
	const repo = createTempRepo();
	try {
		seed(repo);
		repo.writeFile("docs/HISTORY/2026-10-05.md", `${TITLE}${NEXT}${ENTRY}`);
		repo.git(["add", "docs/HISTORY/2026-10-05.md"]);
		const passed = await precommit(repo);
		assert.equal(passed.code, 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.9 EC-8] staged in-place history edit blocks pre-commit", async () => {
	const repo = createTempRepo();
	try {
		seed(repo);
		repo.writeFile(
			"docs/HISTORY/2026-10-05.md",
			BASE.replace("reason", "rewritten"),
		);
		repo.git(["add", "docs/HISTORY/2026-10-05.md"]);
		const blocked = await precommit(repo);
		assert.equal(blocked.code, 1);
		assert.ok(blocked.stdout.includes("core/history-append-only"));
	} finally {
		repo.cleanup();
	}
});
