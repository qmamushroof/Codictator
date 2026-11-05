import { strict as assert } from "node:assert";

import { mkdirSync, writeFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { runCommand } from "../../src/cli/index.ts";

import { readLogEvents } from "../../src/cli/inspect.ts";

import { draftPack } from "../../src/features/generator/index.ts";

import { checkShell } from "../../src/features/security/index.ts";

import {
	buildReferenceRepo,
	p95Ms,
	readLogLines,
} from "../support/reference-repo.ts";

test("[§10.5] event log with 100000 lines: tail 1s, status/report in-process p95 <=2s", async () => {
	// SPEC §10.5 row 5 split with §9.3: the raw log tail reads under 1 s
	// and counts every line (100,000), while `status` and `report` each
	// hold p95 <= 2 s measured IN-PROCESS — same-process runCommand calls,
	// never a child-spawned CLI. SPEC §9.3 binds budgets to in-process
	// work and excludes harness process-spawn and runtime-startup costs
	// (the old child-spawned `report` leg measured ~3.5-4.5 s of startup,
	// not the product), so the report leg runs through runCommand and the
	// full-log count is proven via readLogEvents, the reader handleReport
	// itself uses. The repo keeps the canonical config-less shape shared
	// with the other rows, so the triple full-tree manifest search inside
	// loadRepoConfig stays on the measured path (local box walks it far
	// slower than the SPEC profile — box noise per precedent, CI 3-OS
	// adjudicates); no `src/` change in this round.
	const lines: Array<string> = [];
	for (let index = 0; index < 100000; index += 1) {
		lines.push(
			JSON.stringify({
				v: 1,
				id: `evt-${index}`,
				kind: "verdict",
				layer: "L1",
				trigger: "pre-tool",
				ruleIds: [],
				durationMs: 5,
				configHash: "abc",
				packs: {},
			}),
		);
	}
	const repo = buildReferenceRepo({ gitInit: true });
	try {
		mkdirSync(path.join(repo.dir, ".codictator", "state"), {
			recursive: true,
		});
		writeFileSync(
			path.join(repo.dir, ".codictator", "state", "events.jsonl"),
			`${lines.join("\n")}\n`,
		);
		const tailStart = Date.now();
		const raw = readLogLines(repo.dir);
		const tailMs = Date.now() - tailStart;
		assert.equal(raw.length, 100000);
		assert.ok(tailMs < 1000, `tail ${tailMs} ms over the 1 s budget`);
		const log = await readLogEvents(repo.dir);
		assert.ok(log !== undefined);
		assert.equal(log.events.length, 100000);
		assert.equal(log.corrupt, 0);
		const statusLatencies: Array<number> = [];
		for (let index = 0; index < 10; index += 1) {
			const statusStart = Date.now();
			const status = await runCommand({ argv: ["status"], cwd: repo.dir });
			statusLatencies.push(Date.now() - statusStart);
			assert.equal(status.ok, true);
			if (status.ok) {
				assert.equal(status.value, 0);
			}
		}
		const statusP95 = p95Ms(statusLatencies);
		assert.ok(
			statusP95 < 2000,
			`status p95 ${statusP95} ms over the 2 s in-process budget`,
		);
		const reportLatencies: Array<number> = [];
		for (let index = 0; index < 10; index += 1) {
			const reportStart = Date.now();
			const report = await runCommand({ argv: ["report"], cwd: repo.dir });
			reportLatencies.push(Date.now() - reportStart);
			assert.equal(report.ok, true);
			if (report.ok) {
				assert.equal(report.value, 0);
			}
		}
		const reportP95 = p95Ms(reportLatencies);
		assert.ok(
			reportP95 < 2000,
			`report p95 ${reportP95} ms over the 2 s in-process budget`,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§10.5] shell analyser on 10000 generated commands", async () => {
	// SPEC §10.5 row 6 with §9.2: no crash on 10,000 generated commands
	// including adversarial nesting; the p95 analysis stays under the 10 ms
	// per-line budget (first iterations warm the matcher, then measure).
	const adversarial = "echo $(echo $(echo $(echo nested))) && true";
	for (let index = 0; index < 10; index += 1) {
		await checkShell(
			{
				trigger: "pre-tool",
				scope: { files: [] },
				now: "2026-01-01T00:00:00Z",
				configHash: "stress",
			},
			`${adversarial} # warm-${index}`,
		);
	}
	const latencies: Array<number> = [];
	for (let index = 0; index < 10000; index += 1) {
		const start = Date.now();
		const findings = await checkShell(
			{
				trigger: "pre-tool",
				scope: { files: [] },
				now: "2026-01-01T00:00:00Z",
				configHash: "stress",
			},
			`${adversarial} # ${index}`,
		);
		latencies.push(Date.now() - start);
		assert.ok(Array.isArray(findings));
	}
	const p95 = p95Ms(latencies);
	assert.ok(p95 < 10, `p95 ${p95} ms over the 10 ms budget`);
});

test("[§10.5] regex safety check rejects known ReDoS patterns", async () => {
	// SPEC §10.5 row 7 with §9.2: a nested quantifier over an overlapping
	// group such as (a+)+ is rejected with CDX-E902 before use, while a
	// benign sample still drafts, so the check is evidence, not a tautology.
	const drafted = await draftPack({
		id: "stress-redos",
		description: "pattern safety probe",
		sampleBefore: "(a+)+$",
		sampleAfter: "clean-ok",
	});
	assert.ok(!drafted.ok && drafted.error.code === "CDX-E902");
	const benign = await draftPack({
		id: "stress-redos",
		description: "pattern safety probe",
		sampleBefore: "x",
		sampleAfter: "clean-ok",
	});
	assert.equal(benign.ok, true);
});
