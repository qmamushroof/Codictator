// SPEC §4.4, §4.5.7, §4.12.4, §4.10, §4.13 + §4.16: branch coverage for
// the pack, adapter, serve, review, test-proof and remediation handlers,
// none of which the red ledger pins. Each scenario drives the built entry
// in a child process (the EC-6 pattern in audit.test.ts). Nothing reaches
// the network; no wall clock is asserted.
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readTask } from "../../../src/cli/tasks.ts";
import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";
import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
}

function jsonOut(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
}

function seedConfig(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function seedTask(repo: TempRepo): void {
	repo.writeFile(
		".codictator/tasks/T-0001.json",
		`${JSON.stringify({
			version: 1,
			id: "T-0001",
			type: "docs",
			title: "task",
			branch: "main",
			phase: "discovery",
			phases: [],
			spec: [],
			acceptanceCriteria: [],
			files: { allow: [] },
		})}\n`,
	);
}

test("[§4.16] generate with an LLM names the later pipeline", async () => {
	// SPEC §4.16: with config.llm set the command reaches the pipeline
	// stub and fails as CDX-E903 (exit 5) until generation lands.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				packs: [],
				harnesses: ["muse-code", "opencode"],
				llm: {},
			}),
		);
		const ran = await cli(["generate"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("generation pipeline unavailable"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list with an arg is a usage error", async () => {
	// SPEC §4.19.2: list takes no args.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "list", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator pack list"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test of a missing custom pack fails closed", async () => {
	// SPEC §4.4: a custom pack that is not installed fails with the
	// loader's code (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["pack", "test", "nope"], repo.dir);
		assert.equal(ran.code, 3);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test and accept need exactly one id", async () => {
	// SPEC §4.19.2: an extra positional is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const tested = await cli(["pack", "test", "a", "b"], repo.dir);
		assert.equal(tested.code, 2);
		assert.ok(tested.stderr.includes("usage: codictator pack test"));
		const accepted = await cli(["pack", "accept"], repo.dir);
		assert.equal(accepted.code, 2);
		assert.ok(accepted.stderr.includes("usage: codictator pack accept"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test and capture need exactly one id", async () => {
	// SPEC §4.19.2: a missing id is a usage error, checked before any
	// harness lookup.
	const repo = createTempRepo();
	try {
		const tested = await cli(["adapter", "test"], repo.dir);
		assert.equal(tested.code, 2);
		assert.ok(tested.stderr.includes("usage: codictator adapter"));
		const captured = await cli(["adapter", "capture"], repo.dir);
		assert.equal(captured.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture outside a repo fails CDX-E703", async () => {
	// SPEC §4.5.7: a known harness still resolves the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-noadapter-"));
	try {
		const ran = await cli(["adapter", "capture", "muse-code"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.16] generate without config fails CDX-E101", async () => {
	// SPEC §4.16: generation reads config first; without it the command
	// fails as CDX-E101 (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["generate"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E101"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.16] generate without an LLM fails CDX-E851", async () => {
	// SPEC §4.16: custom guardrails need the LLM draft pipeline; without
	// config.llm the command fails as CDX-E851 (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["generate"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E851"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list fails closed on a missing builtin pack", async () => {
	// SPEC §4.4.1: pack loading fails closed with the pack's own code;
	// the dotnet builtin has no pack.json yet, so list reports CDX-E203
	// (exit 3) instead of a partial list.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "list"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E203"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside list/test/accept is a usage error.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator pack"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test without an id is a usage error", async () => {
	// SPEC §4.19.2: test takes exactly one id.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "test"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator pack test"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test reports the failing builtin self-test", async () => {
	// SPEC §4.4.4: the core pack self-test currently throws in the
	// agent-assets-present enforcer, so test reports CDX-E901 (exit 7)
	// instead of a pass.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["pack", "test", "core"], repo.dir);
		assert.equal(ran.code, 7);
		assert.ok(ran.stderr.includes("CDX-E901"));
		assert.ok(ran.stderr.includes("self-test"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack accept is human-only", async () => {
	// SPEC §4.2.3: acceptance stays human-only, so the child process
	// without a TTY is refused with CDX-E107 (exit 4) before the
	// builtin shortcut.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["pack", "accept", "core"], repo.dir);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test rejects an unknown harness", async () => {
	// SPEC §4.5.7: unknown harness ids fail as CDX-E301 (exit 3).
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "test", "nope"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E301"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test prints capability declarations", async () => {
	// SPEC §4.5.7: a known harness prints its per-layer declaration.
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "test", "muse-code"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("muse-code: layers"));
		const asJson = await cli(
			["--json", "adapter", "test", "muse-code"],
			repo.dir,
		);
		assert.equal(asJson.code, 0);
		const body = jsonOut(asJson.stdout) as { harness: string };
		assert.equal(body.harness, "muse-code");
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside test/capture is a usage error.
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "bogus", "muse-code"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator adapter"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture rejects an unknown harness", async () => {
	// SPEC §4.5.7: capture validates the harness before resolving root.
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "capture", "nope"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E301"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture records the harness", async () => {
	// SPEC §4.5.7: a known harness observation lands without a write.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["adapter", "capture", "muse-code"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("captured harness observation"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] serve without the stdio flag is a usage error", async () => {
	// SPEC §4.19.5: the server takes exactly --stdio.
	const repo = createTempRepo();
	try {
		const ran = await cli(["serve"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator serve --stdio"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] serve stdio names the later phase", async () => {
	// SPEC §4.19.5: the stdio server lands in phase 11, so the command
	// fails closed as CDX-E903 (exit 5) until then.
	const repo = createTempRepo();
	try {
		const ran = await cli(["serve", "--stdio"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("phase 11"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside submit/resolve is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["review", "bogus", "--file", "f.json"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator review"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit needs a file flag", async () => {
	// SPEC §4.19.2: submit without --file is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["review", "submit"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator review"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with a missing file fails CDX-E607", async () => {
	// SPEC §4.12.4: an unreadable findings file fails closed (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E607"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with a bad file fails CDX-E607", async () => {
	// SPEC §4.12.4: findings that are not JSON fail closed (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile("findings.json", "not json\n");
		const ran = await cli(
			["review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E607"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit verdicts a findings file with blockers", async () => {
	// SPEC §4.12.4: an empty findings file carries no review round, so
	// the verdict blocks (exit 1) with the finding and blocker counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			JSON.stringify({ version: 1, findings: [] }),
		);
		const ran = await cli(
			["--json", "review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 1);
		const body = jsonOut(ran.stdout) as { findings: number; blockers: number };
		assert.equal(body.findings, 2);
		assert.equal(body.blockers, 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit records the round on the task", async () => {
	// SPEC §4.12.4: a fully bound round with no blockers records on the
	// task when --task names it.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/tasks/T-0001.json",
			JSON.stringify({
				version: 1,
				id: "T-0001",
				type: "docs",
				title: "task",
				branch: "main",
				phase: "review",
				phases: [],
				spec: [],
				acceptanceCriteria: [],
				files: { allow: [] },
			}),
		);
		repo.writeFile(
			"findings.json",
			JSON.stringify({
				version: 1,
				findings: [],
				tree: "abc",
				reviewerSession: "sess-1",
			}),
		);
		const ran = await cli(
			[
				"--json",
				"review",
				"submit",
				"--file",
				"findings.json",
				"--task",
				"T-0001",
			],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		const recorded = await readTask(repo.dir, "T-0001");
		assert.equal(recorded?.reviews?.length, 1);
		assert.equal(recorded?.reviews?.[0]?.reviewerSession, "sess-1");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with an unreadable absolute path fails CDX-E607", async () => {
	// SPEC §4.12.4: an absolute --file stays inside the repo root, so a
	// path outside it reads back unreadable.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["review", "submit", "--file", "/no-such-dir/findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E607"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit with a shapeless findings file fails CDX-E607", async () => {
	// SPEC §4.12.4: findings that are not a list fail closed (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			JSON.stringify({ version: 1, findings: {} }),
		);
		const ran = await cli(
			["review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E607"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review submit prints human verdicts", async () => {
	// SPEC §4.12.4: the human rendering prints each finding, and resolve
	// reports the still-open blockers and majors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"findings.json",
			JSON.stringify({ version: 1, findings: [] }),
		);
		const submitted = await cli(
			["review", "submit", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(submitted.code, 1);
		assert.ok(submitted.stdout.includes("core/"));
		const resolved = await cli(
			["review", "resolve", "--file", "findings.json"],
			repo.dir,
		);
		assert.equal(resolved.code, 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] review outside a repo fails CDX-E703", async () => {
	// SPEC §4.12.4: the review words resolve the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-noreview-"));
	try {
		const ran = await cli(["review", "submit", "--file", "findings.json"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.12] test proof usage rejects a bare word", async () => {
	// SPEC §4.19.2: test takes red|green with a task and titles.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["test", "red"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator test"));
		const bare = await cli(["test", "bogus"], repo.dir);
		assert.equal(bare.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] test proof for an unknown task fails CDX-E903", async () => {
	// SPEC §4.12.4: proof attaches to the task record; unknown ids fail
	// closed (exit 5).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["test", "red", "--task", "T-0099", "Some title"],
			repo.dir,
		);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] test proof without a commit fails CDX-E703", async () => {
	// SPEC §4.12.4: red and green proofs bind HEAD, so an unborn HEAD
	// fails closed (exit 6).
	const repo = createTempRepo();
	try {
		seedTask(repo);
		const ran = await cli(
			["test", "red", "--task", "T-0001", "Some title"],
			repo.dir,
		);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] test proof records red and green", async () => {
	// SPEC §4.12.4: with a commit the proof binds HEAD and tree.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo);
		const red = await cli(
			["test", "red", "--task", "T-0001", "Some title"],
			repo.dir,
		);
		assert.equal(red.code, 0);
		assert.ok(red.stdout.includes("recorded red proof for T-0001"));
		const green = await cli(
			["test", "green", "--task", "T-0001", "T"],
			repo.dir,
		);
		assert.equal(green.code, 0);
		assert.ok(green.stdout.includes("recorded green proof for T-0001"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan tolerates baseline shapes", async () => {
	// SPEC §4.13: a baseline file that is not an object, or an object
	// without entries, falls back to the empty baseline.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(".codictator/baseline.json", "[]\n");
		const listed = await cli(["remediate", "plan"], repo.dir);
		assert.equal(listed.code, 0);
		assert.ok(listed.stdout.includes("planned"));
		repo.writeFile(".codictator/baseline.json", JSON.stringify({ version: 1 }));
		const bare = await cli(["remediate", "plan"], repo.dir);
		assert.equal(bare.code, 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan with an extra arg is a usage error", async () => {
	// SPEC §4.19.2: plan takes no args.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["remediate", "plan", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator remediate plan"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status renders as data", async () => {
	// SPEC §4.13: the status counts ship as --json for the extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [{ id: "s1", status: "open" }] }),
		);
		const ran = await cli(["--json", "remediate", "status"], repo.dir);
		assert.equal(ran.code, 0);
		assert.deepEqual(jsonOut(ran.stdout), { done: 0, total: 1 });
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate rejects a plan that is not an object", async () => {
	// SPEC §4.13: a plan file that is a bare list is not a plan.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(".codictator/remediation-plan.json", "[]\n");
		const ran = await cli(["remediate", "status"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("not a plan"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run completes a done step", async () => {
	// SPEC §4.13.4: a step already done runs clean (exit 1 with the
	// completion note, no gates to evaluate).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [{ id: "s1", status: "done" }] }),
		);
		const ran = await cli(["remediate", "run", "s1"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stdout.includes("ran step s1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside plan/next/run/status is a usage
	// error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["remediate", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator remediate"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate plan writes a plan", async () => {
	// SPEC §4.13: the plan generates from the baseline and saves.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["remediate", "plan"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("planned"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status without a plan fails CDX-E903", async () => {
	// SPEC §4.13: status, next and run need a saved plan first.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["remediate", "status"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("no remediation plan"));
		const next = await cli(["remediate", "next"], repo.dir);
		assert.equal(next.code, 5);
		const run = await cli(["remediate", "run", "s1"], repo.dir);
		assert.equal(run.code, 5);
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate rejects a corrupt plan", async () => {
	// SPEC §4.13: a plan file that is not a plan fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ nope: true }),
		);
		const ran = await cli(["remediate", "status"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("not a plan"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate status and next read a saved plan", async () => {
	// SPEC §4.13: status reports done/total, next names the first open
	// step.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [{ id: "s1", status: "open" }] }),
		);
		const status = await cli(["remediate", "status"], repo.dir);
		assert.equal(status.code, 0);
		assert.ok(status.stdout.includes("remediation progress: 0/1 done"));
		const next = await cli(["remediate", "next"], repo.dir);
		assert.equal(next.code, 0);
		assert.ok(next.stdout.includes("next step: s1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate next with a done plan completes", async () => {
	// SPEC §4.13: with every step done there is no next step.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [] }),
		);
		const ran = await cli(["remediate", "next"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("remediation plan complete"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run without gate evidence fails CDX-E608", async () => {
	// SPEC §4.13.4: a step without a clean tree fails closed (exit 1).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [{ id: "s1", status: "open" }] }),
		);
		const ran = await cli(["remediate", "run", "s1"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stderr.includes("CDX-E608"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.13] remediate run without an id is a usage error", async () => {
	// SPEC §4.19.2: run takes exactly one id.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/remediation-plan.json",
			JSON.stringify({ version: 1, steps: [] }),
		);
		const ran = await cli(["remediate", "run"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator remediate run"));
	} finally {
		repo.cleanup();
	}
});
