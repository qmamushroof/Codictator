import { strict as assert } from "node:assert";

import test from "node:test";

import type { SetupStep } from "../../../src/cli/setup.ts";

import {
	setupInstallHere,
	setupInstallLayout,
} from "../../../src/cli/setup-install.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import type { ProcOptions, ProcResult } from "../../../src/kernel/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

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

function okProc(): ProcResult {
	return {
		code: 0,
		stdout: "ok",
		stderr: "",
		timedOut: false,
		truncated: false,
	};
}

function fakeRun(
	recorded: Array<string>,
): (argv: ReadonlyArray<string>, options: ProcOptions) => Promise<ProcResult> {
	return (argv) => {
		recorded.push(argv[argv.length - 1] ?? "");
		return Promise.resolve(okProc());
	};
}

test("[§4.19.6] layout consent shows the manifest prompt on the TTY path", async () => {
	// SPEC §4.19.6: the TTY consent gate displays the exact mutation, so
	// the prompt seam receives the full human-readable message.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const shown: Array<string> = [];
		const steps: Array<SetupStep> = [];
		const laid = await setupInstallLayout(req([], repo.dir), repo.dir, steps, {
			isTty: () => true,
			prompt: (message) => {
				shown.push(message);
				return Promise.resolve("y");
			},
		});
		assert.equal(laid.ok, true);
		assert.equal(shown.length, 1);
		assert.ok(shown[0]?.includes(".codictator/tool/package.json"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] lockfile consent-yes shows the npm commands on the TTY path", async () => {
	// SPEC §4.19.6: a TTY yes runs `npm install` then `npm ci`; the shown
	// prompt names both commands and the target directory.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
	});
	try {
		const shown: Array<string> = [];
		const recorded: Array<string> = [];
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir),
			repo.dir,
			{
				dir: `${repo.dir}/.codictator/tool`,
				lockRel: ".codictator/tool/package-lock.json",
				dirRel: ".codictator/tool",
			},
			steps,
			{
				isTty: () => true,
				run: fakeRun(recorded),
				prompt: (message) => {
					shown.push(message);
					return Promise.resolve("yes");
				},
			},
		);
		assert.equal(ran.ok, true);
		assert.deepEqual(recorded, ["install", "ci"]);
		assert.equal(shown.length, 1);
		assert.ok(shown[0]?.includes("npm install"));
		assert.ok(shown[0]?.includes(".codictator/tool"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] lockfile consent-no shows the prompt then fails E003", async () => {
	// SPEC §4.19.6: a TTY no still sees the prompt, then the run fails
	// closed with CDX-E003 before any spawn.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
	});
	try {
		const shown: Array<string> = [];
		const recorded: Array<string> = [];
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir),
			repo.dir,
			{
				dir: `${repo.dir}/.codictator/tool`,
				lockRel: ".codictator/tool/package-lock.json",
				dirRel: ".codictator/tool",
			},
			steps,
			{
				isTty: () => true,
				run: fakeRun(recorded),
				prompt: (message) => {
					shown.push(message);
					return Promise.resolve("n");
				},
			},
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(recorded.length, 0);
		assert.equal(shown.length, 1);
	} finally {
		repo.cleanup();
	}
});
