// Slice 0 meta-guard, part 3: every L3/L4-mapped floor rule fires on its gate
// probe (staged pre-commit, commit-msg, ci verify range) through the
// installed launcher and CLI. Red today (G5–G6); slices 3–4 green these rows.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	installConsumer,
	srcMain,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { runStageProbes } from "../support/consumer-l3-stage.ts";
import { runRangeProbe } from "../support/consumer-l4-range.ts";
import { findingIds, MATRIX } from "../support/consumer-matrix.ts";
import { createTempRepo } from "../support/temp-repo.ts";

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
		// SPEC §4.15.1: the ranged verify answers with a JSON findings list,
		// so a silent row means a missing finding, not an unparsed run.
		assert.ok(
			Array.isArray((JSON.parse(v1.stdout) as { findings?: unknown }).findings),
			`ci verify --json printed no findings list: ${v1.stdout.slice(0, 200)}`,
		);
		hits.set("verify-norange-history::core/history-entry", {
			fired: v1.code !== 0 && v1ids.includes("core/history-entry"),
			detail: v1ids.join(",").slice(0, 300),
		});
		await runRangeProbe(tddRepo, hits);
		const rangeRows = MATRIX.filter(
			([, probe]) => probe === "verify-tdd-range",
		);
		assert.ok(
			rangeRows.every(([rule, probe]) => hits.has(`${probe}::${rule}`)),
			"the range probe records a hit for every verify-tdd-range row",
		);
		// The two rows SPEC leaves undecided (BUG-0108): no pack names its
		// coverage-threshold keys (§4.10.4 vs §6.1/§6.3), and §4.2.1 step 3
		// contradicts §4.4.5 EC-4 for a failing custom pack. Every other
		// range row fires; a new silent row fails here first.
		assert.deepEqual(
			rangeRows
				.filter(
					([rule, probe]) => hits.get(`${probe}::${rule}`)?.fired !== true,
				)
				.map(([rule]) => rule),
			["core/no-threshold-lowering", "core/custom-pack-selftest"],
		);
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
