// BUG-0095 + SPEC §4.4.1, §4.4.4: `pack test` runs the real CLI over each
// case.json. The core built-in passes; a custom pack whose violating case
// does not violate fails CDX-E212 (exit 1) instead of passing vacuously.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runNodeScript } from "../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

const RULE = "mypack/file-size";

function seedConfig(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function rows(count: number): string {
	const lines: Array<string> = [];
	for (let n = 1; n <= count; n += 1) {
		lines.push(`export const row${n} = 1;`);
	}
	return `${lines.join("\n")}\n`;
}

function caseJson(
	expectation: "violating" | "passing",
	lines: number,
	expectRules: ReadonlyArray<string>,
): string {
	return JSON.stringify({
		rule: RULE,
		section: "§5.6",
		expectation,
		trigger: "pre-tool",
		expectRules,
		files: { "src/a.ts": rows(lines) },
	});
}

function seedPack(repo: TempRepo, violatingLines: number): void {
	repo.writeFile(
		".codictator/packs/mypack/pack.json",
		JSON.stringify({
			id: "mypack",
			version: "0.0.0",
			description: "fixture pack with a file-size rule",
			rules: [
				{
					id: RULE,
					family: "F6",
					tier: "tunable",
					statement: "Files stay under maxLines lines.",
					reason: "Oversize files resist review.",
					remediation: "Split {path} below {limit} lines.",
					enforcer: RULE,
					triggers: ["pre-tool"],
					scope: [],
					params: {
						maxLines: {
							type: "integer",
							default: 300,
							bound: 500,
							stricter: "lower",
						},
					},
					ratchet: false,
					measureVersion: 1,
					fixtures: { violating: ["basic"], passing: ["basic"] },
				},
			],
			enforcers: [{ id: RULE, kind: "file-size", budgetMs: 1000, args: {} }],
			maxWaiverDays: 90,
		}),
	);
	repo.writeFile(
		".codictator/packs/mypack/fixtures/file-size/violating/basic/case.json",
		caseJson("violating", violatingLines, [RULE]),
	);
	repo.writeFile(
		".codictator/packs/mypack/fixtures/file-size/passing/basic/case.json",
		caseJson("passing", 5, []),
	);
}

async function packTest(repo: TempRepo, id: string) {
	const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(["pack","test",${JSON.stringify(id)}], ${JSON.stringify(repo.dir)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd: repo.dir,
		timeoutMs: 120000,
	});
}

test("[§4.4.4] pack test core runs the real CLI over every case file and passes", async () => {
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await packTest(repo, "core");
		assert.equal(ran.code, 0, ran.stderr);
		assert.ok(ran.stdout.includes("self-test pass"), ran.stdout);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4.4] pack test of a custom pack passes when its violating case violates", async () => {
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		seedPack(repo, 320);
		const ran = await packTest(repo, "mypack");
		assert.equal(ran.code, 0, ran.stderr);
		assert.ok(ran.stdout.includes("self-test pass"), ran.stdout);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4.4] pack test of a custom pack with a broken violating case fails CDX-E212", async () => {
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		seedPack(repo, 5);
		const ran = await packTest(repo, "mypack");
		assert.notEqual(ran.code, 0);
		assert.ok(`${ran.stdout}${ran.stderr}`.includes("CDX-E212"), ran.stderr);
	} finally {
		repo.cleanup();
	}
});
