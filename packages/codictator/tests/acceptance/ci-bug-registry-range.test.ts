// SPEC §4.9.4 core/bug-registry + BUG-0098: `ci verify` over a two-commit
// range, a fix whose entry names its bug and a later docs change whose entry
// is the newest in the file, judges the fix by its own entry. Driven through
// the real CLI entry over a temp git repo.
import { strict as assert } from "node:assert";
import test from "node:test";
import { parseJson, stableStringify } from "../../src/kernel/index.ts";
import { runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const NL = String.fromCharCode(10);
const CONFIG = {
	version: 1,
	codictator: "unknown",
	packs: [],
	harnesses: ["opencode"],
};
const TASK = {
	version: 1,
	id: "T-0001",
	type: "fix",
	title: "fix a thing",
	branch: "fix/a",
	phase: "integrate",
	phases: [],
	spec: ["docs/SPEC/04-12-WORKFLOW.md"],
	acceptanceCriteria: ["judged as planned"],
	diagnosis: "root cause named",
	files: { allow: ["src/**", "docs/**", "tests/**"] },
};
const BUGS = [
	"# Bugs — 2026",
	"",
	"| Id | Status | Title | Found | Fix | Regression test |",
	"|---|---|---|---|---|---|",
	"| BUG-0001 | fixed | [§1] a defect | 2026-11-14, T-0001 | T-0001, fix(app): fix a thing | tests/a.test.ts |",
	"",
].join(NL);

function entry(
	subject: string,
	task: string,
	kind: string,
	bug?: string,
): string {
	return [
		`## 2026-11-14 · ${subject}`,
		`- **Kind:** ${kind}`,
		`- **Task:** ${task}`,
		...(bug === undefined ? [] : [`- **Bug:** ${bug}`]),
		"- **Why:** reason",
		"- **What went wrong:** nothing",
		"- **Trade-offs:** none",
		"- **Lessons:** learned",
		"",
	].join(NL);
}

const TITLE = `# History — 2026-11-14${NL}${NL}`;

test("[§4.9.4] ci verify judges a fix by its own history entry when a newer docs entry has no Bug row (BUG-0098)", async () => {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		const fixEntry = entry(
			"fix(app): fix a thing",
			"T-0001",
			"code",
			"BUG-0001",
		);
		repo.writeFile("src/a.ts", "export const a = 1;" + NL);
		repo.writeFile("tests/a.test.ts", "// regression" + NL);
		repo.writeFile(".codictator/tasks/T-0001.json", stableStringify(TASK));
		repo.writeFile("docs/BUGS/2026.md", BUGS);
		repo.writeFile("docs/HISTORY/2026-11-14.md", TITLE + fixEntry);
		repo.commit("fix(app): fix a thing");
		repo.writeFile("docs/notes.md", "# Notes" + NL);
		repo.writeFile(
			"docs/HISTORY/2026-11-14.md",
			TITLE + entry("docs: add notes", "T-0002", "docs") + NL + fixEntry,
		);
		repo.commit("docs: add notes");
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
		const registry = (body.findings ?? []).filter(
			(finding) => finding.ruleId === "core/bug-registry",
		);
		assert.deepEqual(registry, []);
	} finally {
		repo.cleanup();
	}
});
