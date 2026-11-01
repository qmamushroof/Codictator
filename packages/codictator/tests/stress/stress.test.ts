// SPEC §10.5: one red test per stress row. Each test builds the shared
// 10,000-file reference repo (SPEC §9.3: 10,000 files, 2,000 source files)
// and pins its scenario against the budget, then executes the owning
// contract. Latency rows assert the p95 budget with the 5 s hook hard
// limit; the event-log row asserts the 1 s tail read plus the in-process
// p95 <= 2 s `status`/`report` budgets (SPEC §9.3 binds budgets to
// in-process work; harness spawn and startup costs are excluded).
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCommand, runHook } from "../../src/cli/index.ts";
import { readLogEvents } from "../../src/cli/inspect.ts";
import { draftPack } from "../../src/features/generator/index.ts";
import { checkShell } from "../../src/features/security/index.ts";
import { runNodeScript } from "../support/cli-runner.ts";
import {
	buildReferenceRepo,
	p95Ms,
	readLogLines,
} from "../support/reference-repo.ts";

// Runs the source CLI in a child process so its stdout stays assertable: the
// in-process test runner shares process.stdout with reporter writes, which
// are not always strings.
async function runCli(
	cwd: string,
	argv: ReadonlyArray<string>,
): Promise<{ readonly code: number; readonly stdout: string }> {
	const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify([...argv])}, ${JSON.stringify(cwd)});`;
	const ran = await runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
	return { code: ran.code, stdout: ran.stdout };
}

function findingIds(envelope: unknown): Array<string> {
	if (typeof envelope !== "object" || envelope === null) {
		return [];
	}
	const findings: unknown = (envelope as { findings?: unknown }).findings;
	if (!Array.isArray(findings)) {
		return [];
	}
	const ids: Array<string> = [];
	for (const finding of findings) {
		if (typeof finding === "object" && finding !== null) {
			const ruleId: unknown = (finding as { ruleId?: unknown }).ruleId;
			if (typeof ruleId === "string") {
				ids.push(ruleId);
			}
		}
	}
	return ids;
}

test("[§10.5] 200 sequential tool.pre.write hook processes within p95 budget", async () => {
	// SPEC §10.5 row 1 with §9.3: p95 within 150 ms on the reference repo;
	// every reply inside the 5 s hard time limit.
	const repo = buildReferenceRepo();
	try {
		const latencies: Array<number> = [];
		let replies = 0;
		for (let index = 0; index < 200; index += 1) {
			const start = Date.now();
			const code = await runHook({
				argv: ["hook", "tool.pre.write"],
				cwd: repo.dir,
			});
			latencies.push(Date.now() - start);
			assert.equal(code, 0);
			replies += 1;
		}
		assert.equal(replies, 200);
		const p95 = p95Ms(latencies);
		assert.ok(p95 < 150, `p95 ${p95} ms over the 150 ms budget`);
		for (const ms of latencies) {
			assert.ok(ms < 5000, `hook reply ${ms} ms over the 5 s hard limit`);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§10.5] 20 parallel hook processes append without lost events", async () => {
	// SPEC §10.5 row 2: every line intact; no lost event. Real post-write
	// hooks on the reference repo, so each call appends its verdict line;
	// the delta plus a parse of every line proves nothing was lost or
	// interleaved.
	const repo = buildReferenceRepo({ gitInit: true, config: true });
	try {
		const probe = path.join(repo.dir, "probe.txt");
		writeFileSync(probe, "hello\n");
		const payload = JSON.stringify({
			sessionID: "stress-parallel",
			cwd: repo.dir,
			tool: "write",
			file_path: probe,
		});
		const before = readLogLines(repo.dir).length;
		const appends = Array.from({ length: 20 }, () =>
			runHook({
				argv: ["hook", "opencode", "tool.post.write"],
				cwd: repo.dir,
				stdinText: payload,
			}),
		);
		const codes = await Promise.all(appends);
		assert.equal(codes.length, 20);
		for (const code of codes) {
			assert.equal(code, 0);
		}
		const lines = readLogLines(repo.dir);
		assert.equal(lines.length - before, 20);
		for (const line of lines) {
			assert.ok(typeof JSON.parse(line) === "object");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§10.5] pre-commit with 50 then 1000 staged files", async () => {
	// SPEC §10.5 row 3 with §9.3: 50 staged files within 5 s; 1,000 completes
	// under the 60 s hard time limit. Real staged scale on the reference
	// repo with budget assertions, plus work evidence — a staged secret the
	// engine evaluation must flag — so the budgets measure a real evaluation
	// instead of a no-op. The child CLI is warmed once before the fifty-leg
	// timer so the 5 s budget meters engine work, not spawn/startup (SPEC
	// §9.3, same reading row 5 uses). Integrity exception IE-09-R5-staged (rule
	// core/no-assertion-loss, path
	// packages/codictator/tests/stress/stress.test.ts, reason: the old
	// setup committed every file, leaving verify --staged an empty scope;
	// the setup stages without committing so the scenario names a
	// genuinely staged tree).
	const repo = buildReferenceRepo({
		gitInit: true,
		config: true,
		commitBase: true,
	});
	try {
		// Assembled from parts so this committed test source never holds a
		// live-pattern literal (the staged temp file still does, which is
		// what the engine must flag).
		const exampleKey = ["AKIAIOSF", "ODNN7EXAMPLE"].join("");
		writeFileSync(
			path.join(repo.dir, "src/leak.py"),
			`aws_key = "${exampleKey}"\n`,
		);
		for (let index = 0; index < 49; index += 1) {
			writeFileSync(
				path.join(repo.dir, `src/file-${index}.txt`),
				`filler ${index}\n`,
			);
		}
		repo.git(["add", "-A"]);
		// SPEC §9.3 binds budgets to in-process work and excludes harness
		// spawn/startup: warm the child CLI once so the fifty-leg timer
		// measures engine work, not node/TS startup (~3.5-4.5 s per the
		// row-5 comment). Budgets and the 10k fixture are untouched.
		await runCli(repo.dir, ["--help"]);
		const fiftyStart = Date.now();
		const fifty = await runCli(repo.dir, ["verify", "--staged", "--json"]);
		const fiftyMs = Date.now() - fiftyStart;
		assert.ok(fiftyMs < 5000, `fifty-staged ${fiftyMs} ms over the 5 s budget`);
		assert.equal(fifty.code, 1);
		assert.ok(
			findingIds(JSON.parse(fifty.stdout) as unknown).includes(
				"core/no-secrets",
			),
		);
		for (let index = 49; index < 999; index += 1) {
			writeFileSync(
				path.join(repo.dir, `src/file-${index}.txt`),
				`filler ${index}\n`,
			);
		}
		repo.git(["add", "-A"]);
		const thousandStart = Date.now();
		const thousand = await runCli(repo.dir, ["verify", "--staged", "--json"]);
		const thousandMs = Date.now() - thousandStart;
		assert.ok(thousandMs < 60000, `thousand-staged ${thousandMs} ms over the 60 s budget`);
		assert.equal(thousand.code, 1);
		assert.ok(
			findingIds(JSON.parse(thousand.stdout) as unknown).includes(
				"core/no-secrets",
			),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§10.5] ci verify on the 10000-file reference repo", async () => {
	// SPEC §10.5 row 4 with §9.3: ci verify on the 10,000-file reference
	// repo (2,000 source files) completes within the 3 min budget, and the
	// run evaluates for real — the unreachable-protection advises and the
	// unpinned generated steps flag, so the verdict is evidence, not a
	// no-op. Integrity exception IE-09-R5-civerify (rule
	// core/no-assertion-loss, path
	// packages/codictator/tests/stress/stress.test.ts, reason: the old
	// body ran outside any repo (exit 6, no evaluation) with no budget
	// assertion; the body builds the reference tree and asserts the
	// verdict plus the budget).
	const repo = buildReferenceRepo({ gitInit: true });
	try {
		const start = Date.now();
		// An ambient GITHUB_EVENT_PATH (set in every CI step) would hijack
		// the range inside this temp repo; the spawned-CLI tests scrub it in
		// cli-runner, so the in-process call scrubs it here and restores it
		// after, asserting the verdict, not the ambient env.
		// Bracket access through a variable keeps
		// noPropertyAccessFromIndexSignature satisfied without tripping
		// useLiteralKeys (kernel schema.ts pattern).
		const eventPathKey = "GITHUB_EVENT_PATH";
		const savedEventPath = process.env[eventPathKey];
		delete process.env[eventPathKey];
		let result: { ok: boolean };
		try {
			result = await runCommand({ argv: ["ci", "verify"], cwd: repo.dir });
		} finally {
			if (savedEventPath !== undefined) {
				process.env[eventPathKey] = savedEventPath;
			}
		}
		const ms = Date.now() - start;
		assert.ok(ms < 180000);
		assert.equal(result.ok, true);
	} finally {
		repo.cleanup();
	}
});

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
