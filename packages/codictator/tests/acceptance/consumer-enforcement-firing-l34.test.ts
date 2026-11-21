// Slice 0 meta-guard, part 3: every L3/L4-mapped floor rule fires on its gate
// probe (staged pre-commit, commit-msg, ci verify range) through the
// installed launcher and CLI. Red today (G5–G6); slices 3–4 green these rows.
import { strict as assert } from "node:assert";
import test from "node:test";
import { MX } from "../support/consumer-fixtures.ts";
import {
	installConsumer,
	srcMain,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { runStageProbes } from "../support/consumer-l3-stage.ts";
import { findingIds, MATRIX } from "../support/consumer-matrix.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

async function tddRange(
	repo: TempRepo,
	hits: Map<string, { fired: boolean; detail: string }>,
): Promise<void> {
	const fixOut = await srcMain(
		["task", "new", "--type", "fix", "--title", "mx"],
		repo.dir,
	);
	assert.equal(fixOut.code, 0, `fix task failed: ${fixOut.stderr}`);
	const match = /created (T-\d+)/.exec(fixOut.stdout);
	const fixId = match?.[1] ?? "";
	assert.ok(fixId !== "", `no fix id in: ${fixOut.stdout}`);
	const amended = await srcMain(
		[
			"task",
			"amend",
			"--id",
			fixId,
			"--spec",
			"docs/SPEC/04-10-TESTING.md",
			"--accept",
			"violations flagged",
			"--diagnosis",
			"null deref",
			"--allow",
			"tests/**",
			"--allow",
			"src/**",
		],
		repo.dir,
	);
	assert.equal(amended.code, 0, `fix amend failed: ${amended.stderr}`);
	repo.writeFile(
		"tests/fixtures/seed.json",
		JSON.stringify({ items: [1, 2, 3, 4] }),
	);
	repo.writeFile(
		"tests/mx.test.ts",
		'import test from "node:test";\n\ntest("ok", () => {});\n',
	);
	writeTreeFile(repo, "src/mx.ts", MX.guardBase);
	writeTreeFile(repo, "py/mx_ok.py", "print(1)\n");
	writeTreeFile(
		repo,
		"package.json",
		JSON.stringify({
			name: "mx",
			version: "0.0.0",
			scripts: { test: "node --test" },
		}),
	);
	repo.git(["add", "-A"]);
	repo.git(["commit", "--no-verify", "-m", "seed tdd baseline"]);
	const base = repo.git(["rev-parse", "HEAD"]).trim();
	repo.writeFile("tests/fixtures/seed.json", JSON.stringify({ items: [1] }));
	repo.writeFile(
		"tests/mx.test.ts",
		'import test from "node:test";\n\ntest("empty", () => {});\n\ntest.skip("skipped", () => {});\n\n// eslint-disable-next-line no-console\nconsole.log("x");\n',
	);
	writeTreeFile(repo, "src/mx.ts", MX.guardHead);
	writeTreeFile(
		repo,
		"package.json",
		JSON.stringify({
			name: "mx",
			scripts: { test: "node --test || true" },
			dependencies: { "left-pad": "latest" },
		}),
	);
	writeTreeFile(repo, "src/mx-abstraction.ts", MX.abstraction);
	// Split literal keeps the runtime violation intact without tripping the
	// repo's own text-scan gates (same idiom as the l34 secret vector).
	writeTreeFile(
		repo,
		"src/mx-types.ts",
		'import { unusedThing } from "./mx";\n\nconst n: numb' +
			'er = "no";\n\nexport const m = 2;\n',
	);
	writeTreeFile(
		repo,
		"py/mx_bad.py",
		"import does_not_exist_xyz\n\neval('1+1')\n",
	);
	writeTreeFile(
		repo,
		"docs/guide.md",
		// "contains" matches the SPEC 04-09 corpus-count regex on purpose.
		"# Guide\n\nSee [missing](./missing.md).\n\nUpdated on 2026-01-01: added things.\n\nThe docs contains 5 guides.\n",
	);
	writeTreeFile(
		repo,
		"docs/HISTORY/2026-11-08.md",
		"# History — 2026-11-08\n\n## 2026-11-08 · fix: thing\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n",
	);
	writeTreeFile(
		repo,
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code"],
			tunables: { "core/max-file-bytes": { maxBytes: 1 } },
		}),
	);
	repo.git(["add", "-A"]);
	repo.git(["commit", "--no-verify", "-m", "fix: consumer widget"]);
	const head = repo.git(["rev-parse", "HEAD"]).trim();
	const result = await srcMain(
		["--json", "ci", "verify", "--base", base, "--head", head],
		repo.dir,
	);
	const ids = findingIds(result.stdout);
	for (const [rule, probe] of MATRIX.filter(
		([, entry]) => entry === "verify-tdd-range",
	)) {
		hits.set(`${probe}::${rule}`, {
			fired: result.code !== 0 && ids.includes(rule),
			detail: ids.join(",").slice(0, 400),
		});
	}
}

test("[consumer] every L3/L4-mapped floor rule fires on its gate probe", async () => {
	const hits = new Map<string, { fired: boolean; detail: string }>();
	const gitRepo = createTempRepo();
	const rangeRepo = createTempRepo();
	const tddRepo = createTempRepo();
	try {
		for (const repo of [gitRepo, rangeRepo, tddRepo]) {
			await installConsumer(repo);
		}
		await runStageProbes(gitRepo, hits);
		rangeRepo.writeFile(
			"docs/BUGS/2026.md",
			"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n",
		);
		rangeRepo.git(["add", "-A"]);
		rangeRepo.git(["commit", "--no-verify", "-m", "track the bug file"]);
		const vBase = rangeRepo.git(["rev-parse", "HEAD"]).trim();
		writeTreeFile(rangeRepo, "src/thing.ts", "export const t = 1;\n");
		rangeRepo.git(["add", "src/thing.ts"]);
		rangeRepo.git(["commit", "--no-verify", "-m", "feat: consumer thing"]);
		const vHead = rangeRepo.git(["rev-parse", "HEAD"]).trim();
		const v1 = await srcMain(
			["--json", "ci", "verify", "--base", vBase, "--head", vHead],
			rangeRepo.dir,
		);
		const v1ids = findingIds(v1.stdout);
		hits.set("verify-norange-history::core/history-entry", {
			fired: v1.code !== 0 && v1ids.includes("core/history-entry"),
			detail: v1ids.join(",").slice(0, 300),
		});
		await tddRange(tddRepo, hits);
		const gateText = [...hits.values()].map((hit) => hit.detail).join("\n");
		for (const rule of ["core/spec-trace", "core/dead-code"]) {
			hits.set(`bydesign::${rule}`, {
				fired: !gateText.includes(rule),
				detail: "review-only, gate-silent by design",
			});
		}
		const misses: Array<string> = [];
		for (const [rule, probe, gap] of MATRIX.filter(
			([, entry]) =>
				entry.startsWith("stage-") ||
				entry === "msg-badsubject" ||
				entry.startsWith("verify-") ||
				entry === "bydesign",
		)) {
			const hit = hits.get(`${probe}::${rule}`);
			if (hit === undefined || !hit.fired) {
				misses.push(
					`${rule} (${probe}, ${gap}) silent: ${hit?.detail ?? "no probe result"}`,
				);
			}
		}
		assert.deepEqual(
			misses,
			[],
			`${misses.length} L3/L4 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		gitRepo.cleanup();
		rangeRepo.cleanup();
		tddRepo.cleanup();
	}
});
