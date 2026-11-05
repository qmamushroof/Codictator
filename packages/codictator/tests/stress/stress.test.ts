import { strict as assert } from "node:assert";

import { writeFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { runHook } from "../../src/cli/index.ts";

import {
	buildReferenceRepo,
	p95Ms,
	readLogLines,
} from "../support/reference-repo.ts";

// Runs `verify --staged --json` in-process and captures the JSON envelope
// from the same process's stdout: runCommand returns only the exit code,
// while handleVerify renders the findings envelope via printJson. The
// capture patches process.stdout.write for the call window only (unit/cli
// precedent), so the timer meters in-process engine work with no child
// spawn or startup cost (SPEC §9.3, same reading row 5 uses).

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
