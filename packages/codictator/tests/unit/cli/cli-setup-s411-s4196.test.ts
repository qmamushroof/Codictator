import { strict as assert } from "node:assert";

import { existsSync, readFileSync } from "node:fs";

import test from "node:test";

import type { SetupStep } from "../../../src/cli/setup.ts";

import {
	setupInstallHere,
	setupInstallLayout,
	setupNpmArgv,
} from "../../../src/cli/setup-install.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import type { ProcOptions, ProcResult } from "../../../src/kernel/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
	nodeVersion: string | undefined = undefined,
	answer: string | undefined = undefined,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion,
		stdinText: answer,
	};
}

interface RecordedRun {
	readonly argv: ReadonlyArray<string>;
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
	result: ProcResult,
	recorded: Array<RecordedRun>,
): (argv: ReadonlyArray<string>, options: ProcOptions) => Promise<ProcResult> {
	return (argv) => {
		recorded.push({ argv });
		return Promise.resolve(result);
	};
}

function toolTarget(dir: string): {
	dir: string;
	lockRel: string;
	dirRel: string;
} {
	return {
		dir: `${dir}/.codictator/tool`,
		lockRel: ".codictator/tool/package-lock.json",
		dirRel: ".codictator/tool",
	};
}

test("[§4.1.1] npm install spawn shell-free win32", () => {
	// SPEC §4.1.1: shell:false always, so the win32 `npm install` spawn
	// execs the real entry beside the running node, never the npm.cmd shim.
	const win32 = setupNpmArgv("win32", "C:\\nodejs\\node.exe", "install");
	assert.equal(win32.length, 3);
	assert.equal(win32[0], "C:\\nodejs\\node.exe");
	assert.equal(win32[2], "install");
	assert.ok((win32[1] ?? "").endsWith("npm-cli.js"));
	assert.ok((win32[1] ?? "").includes("node_modules"));
	assert.deepEqual(setupNpmArgv("linux", "/usr/bin/node", "install"), [
		"npm",
		"install",
	]);
	assert.deepEqual(setupNpmArgv("darwin", "/usr/bin/node"), ["npm", "ci"]);
});

test("[§4.19.6] existing lockfile runs ci with no prompt", async () => {
	// SPEC §4.19.6: a present lockfile needs no consent, so the TTY check
	// never runs and `npm ci` spawns once.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
		".codictator/tool/package-lock.json": '{"lockfileVersion":3}',
	});
	try {
		const recorded: Array<RecordedRun> = [];
		const steps: Array<SetupStep> = [];
		let ttyCalls = 0;
		const ran = await setupInstallHere(
			req([], repo.dir),
			repo.dir,
			toolTarget(repo.dir),
			steps,
			{
				isTty: () => {
					ttyCalls += 1;
					return true;
				},
				run: fakeRun(okProc(), recorded),
			},
		);
		assert.equal(ran.ok, true);
		assert.equal(ttyCalls, 0);
		assert.equal(recorded.length, 1);
		assert.equal(recorded[0]?.argv[recorded[0]?.argv.length - 1], "ci");
		assert.ok(steps.some((step) => step.step === "install-here"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] tool missing manifest needs consent before writing", async () => {
	// SPEC §4.19.6: placing the tool manifest mutates the repo, so a
	// non-TTY run fails closed with CDX-E003 without writing, while a TTY
	// yes writes the exact engine pin.
	const denied = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallLayout(
			req([], denied.dir, false, undefined, "y"),
			denied.dir,
			steps,
			{ isTty: () => false },
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(
			existsSync(`${denied.dir}/.codictator/tool/package.json`),
			false,
		);
	} finally {
		denied.cleanup();
	}
	const allowed = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallLayout(
			req([], allowed.dir, false, undefined, "y"),
			allowed.dir,
			steps,
			{ isTty: () => true },
		);
		assert.equal(ran.ok, true);
		assert.ok(
			readFileSync(
				`${allowed.dir}/.codictator/tool/package.json`,
				"utf8",
			).includes('"codictator"'),
		);
	} finally {
		allowed.cleanup();
	}
});
