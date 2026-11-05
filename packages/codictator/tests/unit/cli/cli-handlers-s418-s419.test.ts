import { strict as assert } from "node:assert";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
	stdin?: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
		...(stdin === undefined ? {} : { stdin }),
	});
}

function jsonOut(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
}

function seedEvent(
	repo: TempRepo,
	id: string,
	packs: Readonly<Record<string, string>>,
): void {
	repo.writeFile(
		".codictator/state/events.jsonl",
		`${JSON.stringify({
			v: 1,
			id,
			ts: "2026-01-01T00:00:00.000Z",
			now: "2026-01-01T00:00:00.000Z",
			kind: "verdict",
			layer: "L1",
			trigger: "pre-tool",
			ruleIds: [],
			durationMs: 5,
			configHash: "abc",
			packs,
		})}\n`,
	);
}

test("[§4.18] explain answers a known code as data", async () => {
	// SPEC §4.18.2: a known error code resolves to its §8 row with the
	// §8.2 exit.
	const repo = createTempRepo();
	try {
		const ran = await cli(["--json", "explain", "CDX-E101"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as {
			code: string;
			exit: number;
			meaning: string;
			remediation: string;
			text: string;
		};
		assert.equal(body.code, "CDX-E101");
		assert.equal(body.exit, 3);
		assert.ok(body.text.includes("CDX-E101"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints a known code as text", async () => {
	// SPEC §4.18.2: the human rendering leads with the greppable code.
	const repo = createTempRepo();
	try {
		const ran = await cli(["explain", "CDX-E503"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("CDX-E503:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints a rule row", async () => {
	// SPEC §4.18.2: a rule id prints its pack row with statement and
	// remediation.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["explain", "core/context-soft-band"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("rule core/context-soft-band"));
		assert.ok(ran.stdout.includes("remediation:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain prints an event verdict and replay", async () => {
	// SPEC §4.18.2: an event id prints its verdict, inputs and replay.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedEvent(repo, "evt-1", { codictator: "0.0.0" });
		const ran = await cli(["explain", "evt-1"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("event evt-1:"));
		assert.ok(ran.stdout.includes("rerun: codictator replay evt-1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] explain of an unknown id maps to CDX-E010", async () => {
	// SPEC §4.18.2 + EC-4: unknown ids print CDX-E010 with the nearest
	// known ids and exit 2.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["explain", "no-such-thing"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("Nearest known ids:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay of an unknown event fails CDX-E010", async () => {
	// SPEC §4.18.2: replaying an event id the log does not hold fails
	// with the unknown-event path (exit 2).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["replay", "nope"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("CDX-E010"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay of a removed pack fails CDX-E011", async () => {
	// SPEC §4.18.6 EC-5: a pack version that is no longer installed names
	// the version needed (exit 6, the install bucket).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedEvent(repo, "evt-old", { codictator: "9.9.9" });
		const ran = await cli(["replay", "evt-old"], repo.dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E011"));
		assert.ok(ran.stderr.includes("9.9.9"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] replay reruns an installed event", async () => {
	// SPEC §4.18.2: an event whose pack matches reruns to its summary.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedEvent(repo, "evt-1", { codictator: "0.0.0" });
		const ran = await cli(["replay", "evt-1"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("rerun: codictator replay evt-1"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status renders the one-screen summary", async () => {
	// SPEC §4.18.3: status prints engine, packs, harness states and the
	// event counts.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["status"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("codictator 0.0.0 status at"));
		assert.ok(ran.stdout.includes("harnesses:"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status json mirrors the screen as data", async () => {
	// SPEC §4.18.3: --json emits the same screen as data for the
	// extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["--json", "status"], repo.dir);
		assert.equal(ran.code, 0);
		const body = jsonOut(ran.stdout) as { engineVersion: string };
		assert.equal(body.engineVersion, "0.0.0");
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status names configured packs", async () => {
	// SPEC §4.18.3: packs from the effective config render as id@version.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				packs: [{ id: "core", version: "1.0.0" }],
				harnesses: ["muse-code", "opencode"],
			}),
		);
		const ran = await cli(["status"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("packs: core@1.0.0"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] status with an unknown flag is a usage error", async () => {
	// SPEC §4.19.6 EC-1: unknown flags are usage errors (exit 2).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["status", "--bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator status"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] verify with a positional is a usage error", async () => {
	// SPEC §4.19.6 EC-1: verify takes flags only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "stray"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] verify with an unknown flag is a usage error", async () => {
	// SPEC §4.19.6 EC-1: unknown flags are usage errors (exit 2).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["verify", "--bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator verify"));
	} finally {
		repo.cleanup();
	}
});
