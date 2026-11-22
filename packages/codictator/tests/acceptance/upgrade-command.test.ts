import { strict as assert } from "node:assert";

import { readFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { runBuiltCli } from "../support/cli-runner.ts";

import { createTempRepo } from "../support/temp-repo.ts";

const CONFIG = '{\n\t"codictator": "0.2.11"\n}\n';
const MANIFEST =
	'{\n\t"name": "app",\n\t"devDependencies": {\n\t\t"codictator": "0.2.11"\n\t}\n}\n';

function repoFiles(): Record<string, string> {
	return { ".codictator/config.json": CONFIG, "package.json": MANIFEST };
}

test("[§4.19 EC-16] upgrade --to an older version exits 2 with CDX-E012 and leaves every file as it was", async () => {
	const repo = createTempRepo(repoFiles());
	try {
		const ran = await runBuiltCli({
			args: ["upgrade", "--to", "0.1.0"],
			cwd: repo.dir,
		});
		assert.equal(ran.code, 2);
		assert.equal(`${ran.stdout}${ran.stderr}`.includes("CDX-E012"), true);
		assert.equal(
			readFileSync(path.join(repo.dir, "package.json"), "utf8"),
			MANIFEST,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-17] upgrade --to the pinned version says already at it and exits 0", async () => {
	const repo = createTempRepo(repoFiles());
	try {
		const ran = await runBuiltCli({
			args: ["upgrade", "--to", "0.2.11"],
			cwd: repo.dir,
		});
		assert.equal(ran.code, 0);
		assert.equal(ran.stdout.includes("already at 0.2.11"), true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-18] an agent session runs upgrade and is not refused as a human-only command", async () => {
	const repo = createTempRepo(repoFiles());
	try {
		const ran = await runBuiltCli({
			args: ["upgrade", "--to", "0.2.11"],
			cwd: repo.dir,
			env: { CODICTATOR_HOOK: "1" },
		});
		assert.equal(ran.code, 0);
		assert.equal(`${ran.stdout}${ran.stderr}`.includes("CDX-E107"), false);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-19] upgrade --to a non-exact or prerelease version exits 2 with CDX-E012", async () => {
	const repo = createTempRepo(repoFiles());
	try {
		for (const version of ["^0.3.0", "0.3", "0.3.0-rc.1"]) {
			const ran = await runBuiltCli({
				args: ["upgrade", "--to", version],
				cwd: repo.dir,
			});
			assert.equal(ran.code, 2);
			assert.equal(`${ran.stdout}${ran.stderr}`.includes("CDX-E012"), true);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-21] upgrade in a repo with no config exits 3 with CDX-E108", async () => {
	const repo = createTempRepo({ "package.json": MANIFEST });
	try {
		const ran = await runBuiltCli({ args: ["upgrade"], cwd: repo.dir });
		assert.equal(ran.code, 3);
		assert.equal(`${ran.stdout}${ran.stderr}`.includes("CDX-E108"), true);
	} finally {
		repo.cleanup();
	}
});
