import { strict as assert } from "node:assert";

import { existsSync, readFileSync } from "node:fs";

import test from "node:test";

import { handleInit } from "../../../src/cli/init.ts";

import type { SetupStep } from "../../../src/cli/setup.ts";

import { handleSetup, SETUP_USAGE } from "../../../src/cli/setup.ts";

import {
	setupInstallHere,
	setupInstallLayout,
} from "../../../src/cli/setup-install.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import type { ProcOptions, ProcResult } from "../../../src/kernel/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

const AGENT_MARKER = "CODICTATOR_HOOK";

function req(args: ReadonlyArray<string>, cwd: string): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

// Runs the body with the agent marker set (SPEC §4.2.3), restoring it.
async function asAgent(body: () => Promise<void>): Promise<void> {
	const before = process.env[AGENT_MARKER];
	process.env[AGENT_MARKER] = "1";
	try {
		await body();
	} finally {
		if (before === undefined) {
			delete process.env[AGENT_MARKER];
		} else {
			process.env[AGENT_MARKER] = before;
		}
	}
}

const OK_PROC: ProcResult = {
	code: 0,
	stdout: "",
	stderr: "",
	timedOut: false,
	truncated: false,
};

function recorder(argvs: Array<ReadonlyArray<string>>) {
	return (
		argv: ReadonlyArray<string>,
		_options: ProcOptions,
	): Promise<ProcResult> => {
		argvs.push(argv);
		return Promise.resolve(OK_PROC);
	};
}

const NO_PROMPT = (): Promise<string> => {
	throw new Error("the consent prompt must not be shown");
};

test("[§4.19 EC-11] an agent runs setup on a repo with no config and adoption proceeds", async () => {
	// SPEC §4.19 EC-11: no CDX-E107; the init path writes the config, then
	// the missing install consent stops the run at CDX-E003 (EC-14).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleSetup(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(existsSync(`${repo.dir}/.codictator/config.json`), true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-12] an agent running setup --repair over an existing config gets CDX-E107 and nothing is written", async () => {
	// SPEC §4.19 EC-12: the one human-only case; the config stays untouched.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": '{"marker":"untouched"}',
	});
	try {
		await asAgent(async () => {
			const ran = await handleSetup(req(["--repair"], repo.dir));
			assert.equal(ran.ok, false);
			if (!ran.ok) {
				assert.equal(ran.error.code, "CDX-E107");
			}
		});
		assert.equal(
			readFileSync(`${repo.dir}/.codictator/config.json`, "utf8"),
			'{"marker":"untouched"}',
		);
		assert.equal(existsSync(`${repo.dir}/.gitignore`), false);
		assert.equal(existsSync(`${repo.dir}/.codictator/manifest.json`), false);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-12] setup --repair over an existing config without a TTY gets CDX-E107", async () => {
	// SPEC §4.19 EC-12 + §4.2.3: no TTY is refused even without agent markers.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": '{"marker":"untouched"}',
	});
	try {
		const ran = await handleSetup(req(["--repair"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
		assert.equal(existsSync(`${repo.dir}/.gitignore`), false);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-13] an agent runs setup over an existing config without --repair and the regen path proceeds", async () => {
	// SPEC §4.19 EC-13: the first run writes the config; the second takes
	// the regen path and is not refused with CDX-E107.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const first = await handleSetup(req([], repo.dir));
		assert.equal(first.ok, false);
		assert.equal(existsSync(`${repo.dir}/.codictator/config.json`), true);
		const second = await handleSetup(req([], repo.dir));
		assert.equal(second.ok, false);
		if (!second.ok) {
			assert.equal(second.error.code, "CDX-E003");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-14] setup without --yes and without a TTY fails CDX-E003 and the tool manifest is not written", async () => {
	// SPEC §4.19 EC-14 + §4.19.6: no prompt, no mutation of the tool scope.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleSetup(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(
			existsSync(`${repo.dir}/.codictator/tool/package.json`),
			false,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-15] setup --yes without a TTY writes the tool manifest and runs install then ci with no prompt", async () => {
	// SPEC §4.19 EC-15: --yes is consent to both installs.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const argvs: Array<ReadonlyArray<string>> = [];
		const deps = {
			isTty: () => false,
			prompt: NO_PROMPT,
			run: recorder(argvs),
			yes: true,
		};
		const laid = await setupInstallLayout(
			req(["--yes"], repo.dir),
			repo.dir,
			steps,
			deps,
		);
		assert.equal(laid.ok, true);
		if (!laid.ok) {
			return;
		}
		assert.equal(existsSync(`${repo.dir}/.codictator/tool/package.json`), true);
		const ran = await setupInstallHere(
			req(["--yes"], repo.dir),
			repo.dir,
			laid.value,
			steps,
			deps,
		);
		assert.equal(ran.ok, true);
		assert.deepEqual(
			argvs.map((argv) => argv[argv.length - 1]),
			["install", "ci"],
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup usage ends with [--repair] [--yes] and init refuses --yes", async () => {
	// SPEC §4.19.6: --yes is a setup-only flag; init keeps the §4.19.2 flags.
	assert.ok(SETUP_USAGE.endsWith("[--repair] [--yes]"));
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const init = await handleInit(req(["--yes"], repo.dir));
		assert.equal(init.ok, true);
		if (init.ok) {
			assert.equal(init.value, 2);
		}
		const setup = await handleSetup(req(["--yes", "extra"], repo.dir));
		assert.equal(setup.ok, true);
		if (setup.ok) {
			assert.equal(setup.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});
