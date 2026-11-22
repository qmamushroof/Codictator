import { strict as assert } from "node:assert";

import { readFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import type { UpgradeDeps } from "../../../src/cli/upgrade.ts";

import { handleUpgrade } from "../../../src/cli/upgrade.ts";

import type { ProcResult } from "../../../src/kernel/index.ts";

import { err, ok } from "../../../src/kernel/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

const CONFIG = '{\n\t"codictator": "0.2.11"\n}\n';
const MANIFEST =
	'{\n\t"name": "app",\n\t"devDependencies": {\n\t\t"codictator": "0.2.11"\n\t}\n}\n';
const FILES = { ".codictator/config.json": CONFIG, "package.json": MANIFEST };

function req(cwd: string): CommandRequest {
	return {
		args: [],
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function proc(code: number, stderr = ""): ProcResult {
	return { code, stdout: "", stderr, timedOut: false, truncated: false };
}

function withExec(
	argvs: Array<ReadonlyArray<string>>,
	reply: (argv: ReadonlyArray<string>) => ProcResult,
): UpgradeDeps {
	return {
		lookup: () => Promise.resolve(ok({ latest: "0.3.0", versions: ["0.3.0"] })),
		exec: (argv) => {
			argvs.push(argv);
			return Promise.resolve(reply(argv));
		},
	};
}

test("[§4.19.8] a registry host off the allowlist is CDX-E702 and writes nothing", async () => {
	const repo = createTempRepo(FILES);
	try {
		const off: UpgradeDeps = {
			lookup: () =>
				Promise.resolve(
					err({ code: "CDX-E702", message: "host", remediation: "allow it" }),
				),
		};
		const ran = await handleUpgrade(req(repo.dir), off);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E702");
		}
		assert.equal(
			readFileSync(path.join(repo.dir, "package.json"), "utf8"),
			MANIFEST,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.8] an npm failure that is not an outage is CDX-E003 and restores every file", async () => {
	const repo = createTempRepo(FILES);
	try {
		const argvs: Array<ReadonlyArray<string>> = [];
		const ran = await handleUpgrade(
			req(repo.dir),
			withExec(argvs, () => proc(1, "npm ERR! peer dependency conflict")),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(argvs.length, 1);
		assert.equal(
			readFileSync(path.join(repo.dir, "package.json"), "utf8"),
			MANIFEST,
		);
		assert.equal(
			readFileSync(path.join(repo.dir, ".codictator/config.json"), "utf8"),
			CONFIG,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.8] the new engine's regen and verify exit codes become the upgrade's exit code", async () => {
	const regenFails = createTempRepo(FILES);
	const verifyFails = createTempRepo(FILES);
	try {
		const first: Array<ReadonlyArray<string>> = [];
		const regen = await handleUpgrade(
			req(regenFails.dir),
			withExec(first, (argv) => proc(argv.includes("regen") ? 3 : 0)),
		);
		assert.deepEqual(regen, ok(3));
		assert.equal(
			first.some((argv) => argv.includes("verify")),
			false,
		);
		const second: Array<ReadonlyArray<string>> = [];
		const verify = await handleUpgrade(
			req(verifyFails.dir),
			withExec(second, (argv) => proc(argv.includes("verify") ? 1 : 0)),
		);
		assert.deepEqual(verify, ok(1));
		assert.equal(
			readFileSync(path.join(verifyFails.dir, "package.json"), "utf8").includes(
				'"0.3.0"',
			),
			true,
		);
	} finally {
		regenFails.cleanup();
		verifyFails.cleanup();
	}
});
