import { strict as assert } from "node:assert";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

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
			".codictator/plan/remediation.json",
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
		repo.writeFile(".codictator/plan/remediation.json", "[]\n");
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
			".codictator/plan/remediation.json",
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
			".codictator/plan/remediation.json",
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
			".codictator/plan/remediation.json",
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
			".codictator/plan/remediation.json",
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
			".codictator/plan/remediation.json",
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
			".codictator/plan/remediation.json",
			JSON.stringify({ version: 1, steps: [] }),
		);
		const ran = await cli(["remediate", "run"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator remediate run"));
	} finally {
		repo.cleanup();
	}
});
