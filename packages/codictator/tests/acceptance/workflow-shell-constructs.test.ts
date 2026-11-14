// SPEC §4.7.2 + BUG-0099: a workflow run: block with a heredoc, an array
// assignment and a multi-line if block is judged through the real CLI entry:
// clean text stays clean and a dangerous command inside it still blocks.
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
const DOLLAR = String.fromCharCode(36);

async function shellFindings(
	runLines: ReadonlyArray<string>,
): Promise<Array<string>> {
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify(CONFIG),
	});
	try {
		const workflow = [
			"jobs:",
			"  build:",
			"    steps:",
			"      - run: |",
			...runLines.map(
				(line) => `          ${line.replaceAll("@{", `${DOLLAR}{`)}`,
			),
			"      - name: done",
			"",
		].join(NL);
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

const CLEAN = [
	"args=(--author bot)",
	"while IFS= read -r f; do",
	'  if [ -n "$f" ]; then args+=(--files="$f"); fi',
	"done < <(git diff --name-only HEAD --)",
	'if [ "@{{ github.event.pull_request.head.repo.fork }}" = "true" ]; then',
	"  args+=(--fork)",
	"fi",
	"node <<'EOF'",
	"const x = (1 in [2]) ? `a @{1}` : '(';",
	"console.log(x);",
	"EOF",
	"printf '%s' \"$out\" | node -e 'process.exit(0)'",
];

test("[§4.7.2] verify accepts a run block with a heredoc, an array and an if block and still blocks a bad command inside (BUG-0099)", async () => {
	assert.deepEqual(await shellFindings(CLEAN), []);
	assert.deepEqual(
		await shellFindings([...CLEAN, "if true; then", "  rm -rf /", "fi"]),
		["core/dangerous-shell"],
	);
	assert.deepEqual(await shellFindings(["bash <<'EOF'", "rm -rf /", "EOF"]), [
		"core/dangerous-shell",
	]);
	assert.deepEqual(await shellFindings(["echo x | node -"]), [
		"core/dangerous-shell",
	]);
});
