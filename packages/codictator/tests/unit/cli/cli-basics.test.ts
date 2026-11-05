import { strict as assert } from "node:assert";

import test from "node:test";

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

test("[§4.3] baseline show reports no baseline when none is captured", async () => {
	// SPEC §4.3.5: without a baseline file the screen names the gap.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["baseline", "show"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("no baseline captured"));
		const asJson = await cli(["--json", "baseline", "show"], repo.dir);
		assert.equal(asJson.code, 0);
		assert.deepEqual(jsonOut(asJson.stdout), { baseline: null });
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline show prints a captured baseline", async () => {
	// SPEC §4.3.5: a captured baseline prints verbatim (human) or parsed
	// (--json).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/baseline.json",
			`${JSON.stringify({ version: 1, entries: {} })}\n`,
		);
		const ran = await cli(["baseline", "show"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes('"version":1'));
		const asJson = await cli(["--json", "baseline", "show"], repo.dir);
		assert.equal(asJson.code, 0);
		assert.deepEqual(jsonOut(asJson.stdout), {
			baseline: { version: 1, entries: {} },
		});
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside show/capture is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["baseline", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator baseline"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.3] baseline capture without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: capture is human-only, so the child process without a
	// TTY is refused with CDX-E107 (exit 4) before flags are parsed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["baseline", "capture", "--rule", "core/no-secrets"],
			repo.dir,
		);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check without manifests fails CDX-E903", async () => {
	// SPEC §4.8 + §4.13.1: with no manifests there is nothing to analyse.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "check"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check reports brownfield findings", async () => {
	// SPEC §4.8: manifests with a missing lockfile surface findings
	// (exit 1) with the data for the extension (--json).
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		const ran = await cli(["--json", "deps", "check"], repo.dir);
		assert.ok(ran.code === 0 || ran.code === 1);
		const body = jsonOut(ran.stdout) as {
			findings: unknown;
			loosePins: unknown;
		};
		assert.ok(Array.isArray(body.findings));
		assert.ok(Array.isArray(body.loosePins));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade needs a snapshot", async () => {
	// SPEC §4.13.1: without registry data or a snapshot the upgrade
	// fails as CDX-E401 (exit 5).
	const repo = createTempRepo();
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "x", version: "0.0.0" }),
		);
		const ran = await cli(["deps", "upgrade"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E401"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with a positional is a usage error", async () => {
	// SPEC §4.19.2: upgrade takes only --pr.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "upgrade", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator deps upgrade"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] deps rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside check/upgrade is a usage error.
	const repo = createTempRepo();
	try {
		const ran = await cli(["deps", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator deps"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify passes with no manifest", async () => {
	// SPEC §4.14.2: without a manifest there is no drift to report, so
	// the run passes with the unverified note. Integrity exception
	// IE-09-R5-verify-note (rule core/no-assertion-loss, path
	// packages/codictator/tests/unit/cli/cli-basics.test.ts, reason: the
	// note now names the evaluated scope as well since verify runs the
	// engine (§4.19.2), so the assertion matches the extended note while
	// still requiring the unverified marker and the pass).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(
			ran.stdout.includes(
				"verify: pass (unverified (no manifest); tracked tree)",
			),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify blocks on an edited manifest", async () => {
	// SPEC §4.14.2: a manifest edited outside regen blocks (exit 1) and
	// names the file.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		repo.writeFile(".codictator/manifest.json", "not json\n");
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 1);
		assert.ok(ran.stdout.includes("core/guardrail-manifest"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify passes after regen", async () => {
	// SPEC §4.14.2: a freshly regenerated tree has no drift.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regenerated = await cli(["regen"], repo.dir);
		assert.equal(regenerated.code, 0);
		const ran = await cli(["verify"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("verify: pass"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with an unknown layer is a usage error", async () => {
	// SPEC §4.19.2: layers are L1..L5; anything else is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "--layer", "L9"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with a lone base flag is a usage error", async () => {
	// SPEC §4.19.2: base and head travel together.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "--base", "abc"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});
