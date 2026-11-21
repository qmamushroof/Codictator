// The L4 range probe of the Slice 0 firing guard: one consumer repo commits
// a baseline, then a head commit that breaks every verify-tdd-range rule,
// and `ci verify --base --head` judges the range. One hit per
// `<probe>::<rule>`. Shared by the umbrella firing test and the per-family
// acceptance test, so the probe payloads are written once.

import { MX } from "./consumer-fixtures.ts";
import { srcMain, writeTreeFile } from "./consumer-harness.ts";
import type { ProbeHit } from "./consumer-l1-run.ts";
import { findingIds, MATRIX } from "./consumer-matrix.ts";
import type { TempRepo } from "./temp-repo.ts";

type Tree = ReadonlyArray<readonly [string, string]>;

const PACKAGE_BASE = JSON.stringify({
	name: "mx",
	version: "0.0.0",
	scripts: { test: "node --test" },
});

// SPEC §6.1: two assertion tokens the head drops (core/no-assertion-loss).
const TEST_BASE =
	'import { strict as assert } from "node:assert";\nimport test from "node:test";\n\ntest("ok", () => {\n  assert.equal(1, 1);\n  assert.ok(true);\n});\n';

// SPEC §4.10.3: a budget line with no config.commands.perf (core/perf-budgets);
// SPEC §6.1: an added skip and an added lint suppression.
const TEST_HEAD =
	'import test from "node:test";\n\n// codictator:budget p95 <= 100\ntest("empty", () => {});\n\ntest.skip("skipped", () => {});\n\n// eslint-disable-next-line no-console\nconsole.log("x");\n';

// SPEC §4.15.2: the generated workflow's verify job, which the head drops.
const WORKFLOW_BASE =
	"name: codictator\non: [push]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx --no-install codictator ci verify\n";

const WORKFLOW_HEAD =
	"name: codictator\non: [push]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run lint\n";

function baseline(count: number): string {
	return JSON.stringify({
		version: 1,
		entries: { "core/function-size@1": { "src/mx.ts": count } },
	});
}

const BASE_TREE: Tree = [
	["tests/fixtures/seed.json", "[\n  1,\n  2,\n  3,\n  4\n]\n"],
	["tests/mx.test.ts", TEST_BASE],
	["src/mx.ts", MX.guardBase],
	["py/mx_ok.py", "print(1)\n"],
	["package.json", PACKAGE_BASE],
	[".github/workflows/codictator.yml", WORKFLOW_BASE],
	[".codictator/baseline.json", baseline(1)],
];

// SPEC §4.12.1 + §7.11: a fix task in review with no review round, no
// declared regression test and no Bug field in its history entry.
function fixTask(branch: string): string {
	return JSON.stringify({
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "mx",
		branch,
		phase: "review",
		phases: [],
		spec: ["docs/SPEC/04-10-TESTING.md"],
		acceptanceCriteria: ["violations flagged"],
		diagnosis: "null deref",
		files: { allow: ["tests/**", "src/**"] },
	});
}

function headTree(branch: string): Tree {
	return [
		["tests/fixtures/seed.json", "[\n  1\n]\n"],
		["tests/mx.test.ts", TEST_HEAD],
		["src/mx.ts", MX.guardHead],
		[
			"package.json",
			JSON.stringify({
				name: "mx",
				scripts: { test: "node --test || true" },
				dependencies: { "left-pad": "latest" },
			}),
		],
		["src/mx-abstraction.ts", MX.abstraction],
		// Split literal keeps the runtime violation intact without tripping
		// the repo's own text-scan gates (same idiom as the l34 secret vector).
		[
			"src/mx-types.ts",
			'import { unusedThing } from "./mx";\n\nconst unusedLocal = 3;\n\nconst n: numb' +
				'er = "no";\n\nexport const m = 2;\n',
		],
		[
			"py/mx_bad.py",
			"import does_not_exist_xyz\n\nx: int = \"no\"\n\neval('1+1')\n",
		],
		// SPEC §6.1: strict mode off (core/compiler-strict).
		["tsconfig.json", '{"compilerOptions":{"strict":false}}\n'],
		[
			"docs/guide.md",
			// "contains" matches the SPEC 04-09 corpus-count regex on purpose.
			"# Guide\n\nSee [missing](./missing.md).\n\nUpdated on 2026-01-01: added things.\n\nThe docs contains 5 guides.\n",
		],
		[
			"docs/HISTORY/2026-11-08.md",
			"# History — 2026-11-08\n\n## 2026-11-08 · fix: thing\n\n- **Kind:** code\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n",
		],
		[".github/workflows/codictator.yml", WORKFLOW_HEAD],
		[".codictator/baseline.json", baseline(2)],
		[".codictator/tasks/T-0001.json", fixTask(branch)],
		// SPEC §4.3.4: a waiver past its expiry (core/waivers-valid).
		[
			".codictator/waivers.json",
			JSON.stringify({
				version: 1,
				waivers: [
					{
						id: "W-0001",
						rule: "core/function-size",
						params: { maxLines: 60 },
						reason: "legacy parser awaiting its planned split",
						created: "2026-01-01",
						expires: "2026-01-31",
						createdBy: "human",
					},
				],
			}),
		],
		// SPEC §4.11.4: the changed config declares no architecture profile
		// (core/arch-profile-declared); the language packs stay loaded.
		[
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "unknown",
				packs: [{ id: "typescript" }, { id: "python" }],
				harnesses: ["muse-code"],
			}),
		],
	];
}

function commitTree(repo: TempRepo, tree: Tree, message: string): string {
	for (const [file, content] of tree) {
		writeTreeFile(repo, file, content);
	}
	repo.git(["add", "-A"]);
	repo.git(["commit", "--no-verify", "-m", message]);
	return repo.git(["rev-parse", "HEAD"]).trim();
}

// SPEC §4.15.1: judge the base..head range and record one hit per
// verify-tdd-range rule of the matrix.
export async function runRangeProbe(
	repo: TempRepo,
	hits: Map<string, ProbeHit>,
): Promise<void> {
	const branch = repo.git(["branch", "--show-current"]).trim();
	const base = commitTree(repo, BASE_TREE, "seed tdd baseline");
	const head = commitTree(repo, headTree(branch), "fix: consumer widget");
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
			detail: `${[...new Set(ids)].join(",").slice(0, 400)} ${result.stderr.slice(0, 200)}`,
		});
	}
}
