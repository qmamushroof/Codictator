import { strict as assert } from "node:assert";

import { existsSync, readFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import type { UpgradeDeps } from "../../../src/cli/upgrade.ts";

import { handleUpgrade, UPGRADE_USAGE } from "../../../src/cli/upgrade.ts";

import type {
	ProcOptions,
	ProcResult,
	Result,
} from "../../../src/kernel/index.ts";

import { err, ok } from "../../../src/kernel/index.ts";

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

const CONFIG = '{\n\t"codictator": "0.2.11",\n\t"packs": ["core"]\n}\n';
const ROOT_MANIFEST =
	'{\n\t"name": "app",\n\t"devDependencies": {\n\t\t"codictator": "0.2.11"\n\t}\n}\n';
const TOOL_MANIFEST =
	'{\n\t"name": "codictator-tool",\n\t"dependencies": {\n\t\t"codictator": "0.2.11"\n\t}\n}\n';

const OK_PROC: ProcResult = {
	code: 0,
	stdout: "",
	stderr: "",
	timedOut: false,
	truncated: false,
};

interface Recorded {
	readonly argv: ReadonlyArray<string>;
	readonly cwd: string;
}

function fakes(
	calls: Array<Recorded>,
	latest = "0.3.0",
	versions: ReadonlyArray<string> = ["0.2.11", "0.3.0"],
	reply: (argv: ReadonlyArray<string>) => ProcResult = () => OK_PROC,
): UpgradeDeps {
	return {
		lookup: () => Promise.resolve(ok({ latest, versions })),
		exec: (argv: ReadonlyArray<string>, options: ProcOptions) => {
			calls.push({ argv, cwd: options.cwd ?? "" });
			return Promise.resolve(reply(argv));
		},
	};
}

function read(dir: string, rel: string): string {
	return readFileSync(path.join(dir, rel), "utf8");
}

test("[§4.19.8] upgrade bumps the root pin, config.codictator and the lockfile, then regen and verify run under the new engine", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": ROOT_MANIFEST,
		"package-lock.json": "{}\n",
	});
	try {
		const calls: Array<Recorded> = [];
		const ran = await handleUpgrade(req([], repo.dir), fakes(calls));
		assert.equal(ran.ok, true);
		assert.equal(read(repo.dir, "package.json").includes('"0.3.0"'), true);
		assert.equal(read(repo.dir, "package.json").includes("0.2.11"), false);
		assert.equal(
			read(repo.dir, ".codictator/config.json").includes('"0.3.0"'),
			true,
		);
		assert.equal(calls.length, 4);
		assert.equal(calls[0]?.argv.includes("--package-lock-only"), true);
		assert.equal(calls[0]?.argv.includes("--ignore-scripts"), true);
		assert.equal(calls[1]?.argv.includes("ci"), true);
		assert.equal(calls[1]?.argv.includes("--ignore-scripts"), true);
		const regen = calls[2]?.argv ?? [];
		assert.equal(regen.includes("regen"), true);
		assert.equal(
			regen.some((arg) =>
				arg.replaceAll("\\", "/").includes("node_modules/codictator/dist"),
			),
			true,
		);
		assert.equal(calls[3]?.argv.includes("verify"), true);
		assert.equal(calls[3]?.argv.includes("--all"), true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.8] upgrade edits the tool manifest and runs npm in the tool dir when the root has no pin", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		".codictator/tool/package.json": TOOL_MANIFEST,
		".codictator/tool/package-lock.json": "{}\n",
	});
	try {
		const calls: Array<Recorded> = [];
		const ran = await handleUpgrade(
			req(["--to", "0.2.12"], repo.dir),
			fakes(calls, "0.3.0", ["0.2.11", "0.2.12", "0.3.0"]),
		);
		assert.equal(ran.ok, true);
		assert.equal(
			read(repo.dir, ".codictator/tool/package.json").includes('"0.2.12"'),
			true,
		);
		assert.equal(
			calls[0]?.cwd.replaceAll("\\", "/").endsWith(".codictator/tool"),
			true,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-17] upgrade to the pinned version is a no-op with nothing written", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": ROOT_MANIFEST,
	});
	try {
		const calls: Array<Recorded> = [];
		const ran = await handleUpgrade(req([], repo.dir), fakes(calls, "0.2.11"));
		assert.deepEqual(ran, ok(0));
		assert.equal(calls.length, 0);
		assert.equal(read(repo.dir, "package.json"), ROOT_MANIFEST);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-19] upgrade --to a version the registry does not publish is CDX-E012 and writes nothing", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": ROOT_MANIFEST,
	});
	try {
		const calls: Array<Recorded> = [];
		const ran = await handleUpgrade(
			req(["--to", "9.9.9"], repo.dir),
			fakes(calls),
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E012");
		}
		assert.equal(calls.length, 0);
		assert.equal(read(repo.dir, "package.json"), ROOT_MANIFEST);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-20] an unreachable registry at the lookup is CDX-E401 and writes nothing", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": ROOT_MANIFEST,
	});
	try {
		const down: UpgradeDeps = {
			lookup: (): Promise<
				Result<{ latest: string; versions: ReadonlyArray<string> }>
			> =>
				Promise.resolve(
					err({ code: "CDX-E401", message: "down", remediation: "retry" }),
				),
		};
		const ran = await handleUpgrade(req([], repo.dir), down);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E401");
		}
		assert.equal(read(repo.dir, "package.json"), ROOT_MANIFEST);
		assert.equal(read(repo.dir, ".codictator/config.json"), CONFIG);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-20] a registry outage during the install restores the manifest, config and lockfile bytes", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": ROOT_MANIFEST,
		"package-lock.json": '{"before":true}\n',
	});
	try {
		const calls: Array<Recorded> = [];
		const outage = fakes(calls, "0.3.0", ["0.2.11", "0.3.0"], () => ({
			...OK_PROC,
			code: 1,
			stderr: "npm ERR! code ENOTFOUND registry.npmjs.org",
		}));
		const ran = await handleUpgrade(req([], repo.dir), outage);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E401");
		}
		assert.equal(read(repo.dir, "package.json"), ROOT_MANIFEST);
		assert.equal(read(repo.dir, ".codictator/config.json"), CONFIG);
		assert.equal(read(repo.dir, "package-lock.json"), '{"before":true}\n');
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-21] upgrade without a config is CDX-E108 and without an engine pin is CDX-E003", async () => {
	const bare = createTempRepo({ "package.json": ROOT_MANIFEST });
	const unpinned = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": '{\n\t"name": "app"\n}\n',
	});
	try {
		const noConfig = await handleUpgrade(req([], bare.dir), fakes([]));
		assert.equal(noConfig.ok, false);
		if (!noConfig.ok) {
			assert.equal(noConfig.error.code, "CDX-E108");
		}
		const noPin = await handleUpgrade(req([], unpinned.dir), fakes([]));
		assert.equal(noPin.ok, false);
		if (!noPin.ok) {
			assert.equal(noPin.error.code, "CDX-E003");
		}
		assert.equal(
			existsSync(path.join(unpinned.dir, "package-lock.json")),
			false,
		);
	} finally {
		bare.cleanup();
		unpinned.cleanup();
	}
});

test("[§4.19 EC-1] upgrade refuses an unknown flag or a positional with its usage line", async () => {
	const repo = createTempRepo({
		".codictator/config.json": CONFIG,
		"package.json": ROOT_MANIFEST,
	});
	try {
		for (const args of [["--nope"], ["0.3.0"], ["--to"]]) {
			const ran = await handleUpgrade(req(args, repo.dir), fakes([]));
			assert.deepEqual(ran, ok(2));
		}
		assert.equal(UPGRADE_USAGE.startsWith("usage: codictator upgrade"), true);
	} finally {
		repo.cleanup();
	}
});
