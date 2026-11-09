// SPEC §4.9.3 + §4.15.1, BUG-0082: `ci verify` judges a multi-commit PR
// range as one scope. A range whose every commit adds its own docs/HISTORY/
// entry owes no further entry, while a code range with no HISTORY file
// still blocks on core/history-entry. Driven through the real CLI entry
// over a temp git repo, the CI shape of the L4 gate.
import { strict as assert } from "node:assert";
import test from "node:test";
import { parseJson } from "../../src/kernel/index.ts";
import { runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

const CONFIG = {
	version: 1,
	codictator: "unknown",
	packs: [],
	harnesses: ["opencode"],
};

function entry(subject: string): string {
	return `## 2026-01-01 · ${subject}\n- **Kind:** code\n- **Task:** none\n- **Why:** the app needs it.\n\n`;
}

const TITLE = "# History — 2026-01-01\n\n";

async function verifyRuleIds(
	repo: TempRepo,
	base: string,
	head: string,
): Promise<Array<string>> {
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
	const body = parsed.value as { findings?: Array<{ ruleId: string }> };
	return (body.findings ?? []).map((finding) => finding.ruleId);
}

function rangeRepo(): { repo: TempRepo; base: string } {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	return { repo, base: repo.git(["rev-parse", "HEAD"]).trim() };
}

test("[§4.9.3] ci verify passes a multi-commit range carrying its HISTORY entry", async () => {
	const { repo, base } = rangeRepo();
	try {
		repo.writeFile("src/a.ts", "export const a = 1;\n");
		const added = entry("feat(app): add a");
		repo.writeFile("docs/HISTORY/2026-01-01.md", TITLE + added);
		repo.commit("feat(app): add a");
		repo.writeFile("tests/a.test.ts", "export const covered = true;\n");
		repo.writeFile(
			"docs/HISTORY/2026-01-01.md",
			TITLE + entry("test(app): cover a") + added,
		);
		repo.commit("test(app): cover a");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const ids = await verifyRuleIds(repo, base, head);
		assert.ok(
			!ids.includes("core/history-entry"),
			`range with a HISTORY entry still flagged: ${ids.join(", ")}`,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.9.3] ci verify blocks a code range with no HISTORY entry", async () => {
	const { repo, base } = rangeRepo();
	try {
		repo.writeFile("src/a.ts", "export const a = 1;\n");
		repo.commit("feat(app): add a");
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const ids = await verifyRuleIds(repo, base, head);
		assert.ok(ids.includes("core/history-entry"));
	} finally {
		repo.cleanup();
	}
});
