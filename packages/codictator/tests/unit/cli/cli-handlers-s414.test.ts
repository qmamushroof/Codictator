import { strict as assert } from "node:assert";

import { existsSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import {
	EXPECTED_HOOKS_PATH,
	HOOK_NAMES,
} from "../../../src/features/integrity/index.ts";

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

test("[§4.14] regen with extra args is a usage error", async () => {
	// SPEC §4.19.2: regen takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["regen", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator regen"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen renders guardrails from config", async () => {
	// SPEC §4.14.5: regen re-renders guardrails from config and reports
	// every regenerated file.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["regen"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("regenerated .codictator/config.json"));
		assert.ok(ran.stdout.includes("regenerated AGENTS.md"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen without config fails closed", async () => {
	// SPEC §4.14.5: without a readable config there is nothing to render.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["regen"], repo.dir);
		assert.ok(ran.code !== 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks with extra args is a usage error", async () => {
	// SPEC §4.19.2: install-hooks takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["install-hooks", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator install-hooks"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks writes the hooks", async () => {
	// SPEC §4.14.4: install-hooks writes the hook scripts and points
	// core.hooksPath at them.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["install-hooks"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("hooks installed at"));
		const first = HOOK_NAMES[0] ?? "pre-commit";
		assert.equal(
			existsSync(path.join(repo.dir, EXPECTED_HOOKS_PATH, first)),
			true,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall with extra args is a usage error", async () => {
	// SPEC §4.19.2: uninstall takes no flags or positionals, checked
	// before the human-only gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["uninstall", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator uninstall"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: uninstall is human-only, so the child process without
	// a TTY is refused with CDX-E107 (exit 4).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["uninstall"], repo.dir);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});
