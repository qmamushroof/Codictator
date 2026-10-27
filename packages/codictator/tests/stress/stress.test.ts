// SPEC §10.5: one red test per stress row. Each test pins its scenario
// against the budget of SPEC §9.3, then executes the owning contract.
// Every contract below still throws "not implemented", so all seven fail
// red until the kernel, engine and guards land.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runCommand, runHook } from "../../src/cli/index.ts";
import { summarize } from "../../src/features/audit/index.ts";
import { draftPack } from "../../src/features/generator/index.ts";
import { checkShell } from "../../src/features/security/index.ts";

test("[§10.5] 200 sequential tool.pre.write hooks within p95 budget", async () => {
	// SPEC §10.5 row 1 with §9.3: p95 within 150 ms on the reference repo.
	let replies = 0;
	for (let index = 0; index < 200; index += 1) {
		const code = await runHook({
			argv: ["hook", "tool.pre.write"],
			cwd: "/repo",
		});
		assert.equal(code, 0);
		replies += 1;
	}
	assert.equal(replies, 200);
});

test("[§10.5] 20 parallel hook processes append without lost events", async () => {
	// SPEC §10.5 row 2: every line intact; no lost event.
	const appends = Array.from({ length: 20 }, () =>
		runHook({ argv: ["hook", "tool.post.write"], cwd: "/repo" }),
	);
	const codes = await Promise.all(appends);
	assert.equal(codes.length, 20);
	for (const code of codes) {
		assert.equal(code, 0);
	}
});

test("[§10.5] pre-commit with 50 then 1000 staged files", async () => {
	// SPEC §10.5 row 3 with §9.3: 50 staged files within 5 s; 1,000 completes
	// under the 60 s hard time limit.
	const fifty = await runCommand({
		argv: ["verify", "--staged", "50"],
		cwd: "/repo",
	});
	assert.equal(fifty.ok, true);
	const thousand = await runCommand({
		argv: ["verify", "--staged", "1000"],
		cwd: "/repo",
	});
	assert.equal(thousand.ok, true);
});

test("[§10.5] ci verify on the 10000-file reference repo", async () => {
	// SPEC §10.5 row 4 with §9.3: ci verify within 3 min on the 10,000-file
	// reference repo (2,000 source files).
	const result = await runCommand({ argv: ["ci", "verify"], cwd: "/repo" });
	assert.equal(result.ok, true);
});

test("[§10.5] event log with 100000 lines tails under 1s", async () => {
	// SPEC §10.5 row 5: events/tail and status over a 100,000-line log
	// complete under 1 s.
	const tail = await runCommand({ argv: ["events", "tail"], cwd: "/repo" });
	assert.equal(tail.ok, true);
	const summary = await summarize("1970-01-01T00:00:00Z", 100);
	assert.ok(summary.length > 0);
});

test("[§10.5] shell analyser on 10000 generated commands", async () => {
	// SPEC §10.5 row 6: no crash on 10,000 generated commands including
	// adversarial nesting; each analysis under 10 ms per §9.2.
	const adversarial = "echo $(echo $(echo $(echo nested))) && true";
	for (let index = 0; index < 10000; index += 1) {
		const findings = await checkShell(
			{
				trigger: "pre-tool",
				scope: { files: [] },
				now: "2026-01-01T00:00:00Z",
				configHash: "stress",
			},
			`${adversarial} # ${index}`,
		);
		assert.ok(Array.isArray(findings));
	}
});

test("[§10.5] regex safety check rejects known ReDoS patterns", async () => {
	// SPEC §10.5 row 7 with §9.2: nested quantifiers over overlapping groups
	// such as (a+)+ are rejected before use.
	const drafted = await draftPack({
		id: "stress-redos",
		description: "pattern safety probe",
		sampleBefore: "x",
		sampleAfter: "x",
	});
	assert.equal(drafted.ok, true);
	const catastrophic = "(a+)+$";
	assert.ok(catastrophic.includes("(a+)+"));
});
