import { strict as assert } from "node:assert";

import { existsSync } from "node:fs";

import test from "node:test";

import type { SetupStep } from "../../../src/cli/setup.ts";

import { setupInstallHere } from "../../../src/cli/setup-install.ts";

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

// SPEC §4.19.6: the index-signature key for the consented-install step
// detail. A variable (not a literal) keeps both tsc `noPropertyAccess`
// and the biome literal-key rule quiet.
const COMMAND_KEY = "command";

test("[§4.19.6] tool missing lockfile consent-yes runs install then ci", async () => {
	// SPEC §4.19.6: a TTY yes runs `npm install` to generate the tool
	// lockfile, then `npm ci`; both runs are recorded as steps.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
	});
	try {
		const recorded: Array<RecordedRun> = [];
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir, false, undefined, "y"),
			repo.dir,
			toolTarget(repo.dir),
			steps,
			{ isTty: () => true, run: fakeRun(okProc(), recorded) },
		);
		assert.equal(ran.ok, true);
		assert.equal(recorded.length, 2);
		assert.equal(recorded[0]?.argv[recorded[0]?.argv.length - 1], "install");
		assert.equal(recorded[1]?.argv[recorded[1]?.argv.length - 1], "ci");
		assert.ok(
			steps.some(
				(step) =>
					step.step === "install" &&
					step.detail?.[COMMAND_KEY] === "npm install",
			),
		);
		assert.ok(steps.some((step) => step.step === "install-here"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] tool missing lockfile consent-no fails E003 with no mutation", async () => {
	// SPEC §4.19.6: a TTY no fails closed with CDX-E003 before any spawn,
	// so no lockfile appears.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
	});
	try {
		const recorded: Array<RecordedRun> = [];
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir, false, undefined, "n"),
			repo.dir,
			toolTarget(repo.dir),
			steps,
			{ isTty: () => true, run: fakeRun(okProc(), recorded) },
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(recorded.length, 0);
		assert.equal(
			existsSync(`${repo.dir}/.codictator/tool/package-lock.json`),
			false,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] tool missing lockfile non-TTY fails E003 with no prompt", async () => {
	// SPEC §4.19.6: without a TTY there is no prompt to answer, so the run
	// fails closed with CDX-E003 even when the answer would be yes.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
	});
	try {
		const recorded: Array<RecordedRun> = [];
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir, false, undefined, "y"),
			repo.dir,
			toolTarget(repo.dir),
			steps,
			{ isTty: () => false, run: fakeRun(okProc(), recorded) },
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(recorded.length, 0);
		assert.equal(
			existsSync(`${repo.dir}/.codictator/tool/package-lock.json`),
			false,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] consented install outage fails E401", async () => {
	// SPEC §4.19.6: a consented `npm install` that hits a registry outage
	// fails with CDX-E401 before `npm ci` is attempted.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/tool/package.json": '{"name":"codictator-tool"}',
	});
	try {
		const recorded: Array<RecordedRun> = [];
		const steps: Array<SetupStep> = [];
		const outage: ProcResult = {
			code: 1,
			stdout: "",
			stderr: "npm error ENOTFOUND registry.npmjs.org",
			timedOut: false,
			truncated: false,
		};
		const ran = await setupInstallHere(
			req([], repo.dir, false, undefined, "y"),
			repo.dir,
			toolTarget(repo.dir),
			steps,
			{ isTty: () => true, run: fakeRun(outage, recorded) },
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E401");
		}
		assert.equal(recorded.length, 1);
		assert.equal(recorded[0]?.argv[recorded[0]?.argv.length - 1], "install");
	} finally {
		repo.cleanup();
	}
});
