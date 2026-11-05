// SPEC §4.19.6: setup orchestration. In-process handler calls: assertions
// read the returned Result, never stdout (the runner shares process.stdout
// with TAP).
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { COMMANDS, USAGE } from "../../../src/cli/commands.ts";
import { runCommand } from "../../../src/cli/index.ts";
import {
	defaultHarnesses,
	type InitFlags,
	runInitSequence,
} from "../../../src/cli/init-plan.ts";
import type { SetupStep } from "../../../src/cli/setup.ts";
import { handleSetup, SETUP_USAGE } from "../../../src/cli/setup.ts";
import {
	ensureGitignoreEntries,
	setupGitignoreStep,
} from "../../../src/cli/setup-gitignore.ts";
import {
	hasEffectivePacks,
	SETUP_PACK_FRESH,
	SETUP_PACK_REPAIR,
	setupHandoffLines,
} from "../../../src/cli/setup-handoff.ts";
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

// SPEC §4.19.6: the index-signature key for the consented-install step
// detail. A variable (not a literal) keeps both tsc `noPropertyAccess`
// and the biome literal-key rule quiet.
const COMMAND_KEY = "command";

function flagsWithPacks(packs: Array<string>): InitFlags {
	return {
		harnesses: [],
		profile: "",
		packs,
		tools: [],
		repair: false,
	};
}

test("[§4.19.6] setup usage names the init-mirroring flags", () => {
	// SPEC §4.19.6: flags mirror init; no positionals.
	assert.ok(SETUP_USAGE.startsWith("usage: codictator setup "));
	assert.ok(SETUP_USAGE.includes("[--harness <id> ...]"));
	assert.ok(SETUP_USAGE.includes("[--profile <app|library|cli|service>]"));
	assert.ok(SETUP_USAGE.includes("[--pack <id> ...]"));
	assert.ok(SETUP_USAGE.includes("[--tool <role>=<command>@<pin> ...]"));
	assert.ok(SETUP_USAGE.includes("[--repair]"));
});

test("[§4.19.6] setup with an unknown flag is a usage error", async () => {
	// SPEC §4.19.6: unknown flag or positional exits 2, before any gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		for (const args of [
			["--bogus"],
			["positional"],
			["--pack", "nope"],
			["--tool", "bogus-role=lat@1.2.3"],
			["--profile", "nope"],
		]) {
			const ran = await handleSetup(req(args, repo.dir));
			assert.equal(ran.ok, true);
			if (ran.ok) {
				assert.equal(ran.value, 2);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: setup is human-only like init.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleSetup(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup guarantees the manifest-owned .gitignore entries", async () => {
	// SPEC §7.1 + §4.19.6 step 3: state, cache and tool node_modules stay
	// ignored. BUG-0026: init wrote no .gitignore entries, so consumer
	// repos staged node_modules; setup now guarantees them.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const first = await ensureGitignoreEntries(repo.dir);
		assert.equal(first.ok, true);
		if (!first.ok) {
			return;
		}
		assert.deepEqual(first.value.added, [
			".codictator/state/",
			".codictator/cache/",
			".codictator/tool/node_modules/",
		]);
		assert.equal(
			readFileSync(`${repo.dir}/.gitignore`, "utf8"),
			".codictator/state/\n.codictator/cache/\n.codictator/tool/node_modules/\n",
		);
		const second = await ensureGitignoreEntries(repo.dir);
		assert.equal(second.ok, true);
		if (!second.ok) {
			return;
		}
		assert.deepEqual(second.value.added, []);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup keeps user .gitignore text and fills the gaps", async () => {
	// SPEC §7.1: the guarantee appends missing entries without touching
	// user text.
	const repo = createTempRepo({
		"README.md": "hi",
		".gitignore": "node_modules/\n.codictator/cache/\n",
	});
	try {
		const ran = await ensureGitignoreEntries(repo.dir);
		assert.equal(ran.ok, true);
		if (!ran.ok) {
			return;
		}
		assert.deepEqual(ran.value.added, [
			".codictator/state/",
			".codictator/tool/node_modules/",
		]);
		assert.equal(
			readFileSync(`${repo.dir}/.gitignore`, "utf8"),
			"node_modules/\n.codictator/cache/\n.codictator/state/\n.codictator/tool/node_modules/\n",
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] the npm spawn target resolves without a shell on win32", () => {
	// SPEC §4.1.1: shell:false always. The bare `npm` shim is an npm.cmd
	// batch file, unresolvable by a shell-less spawn (ENOENT), so win32
	// execs the real entry beside the running node while POSIX keeps `npm`
	// from PATH. This asserts the exact proc argv without running npm.
	const win32 = setupNpmArgv("win32", "C:\\nodejs\\node.exe");
	assert.equal(win32.length, 3);
	assert.equal(win32[0], "C:\\nodejs\\node.exe");
	assert.equal(win32[2], "ci");
	assert.ok((win32[1] ?? "").endsWith("npm-cli.js"));
	assert.ok((win32[1] ?? "").includes("node_modules"));
	assert.deepEqual(setupNpmArgv("linux"), ["npm", "ci"]);
	assert.deepEqual(setupNpmArgv("darwin"), ["npm", "ci"]);
});

test("[§4.19.6] setup handoff prints exact runnable commands only when packs are empty", () => {
	// SPEC §4.19.6 step 8: pack-less setup prints the exact one-line
	// commands; a setup with packs keeps the generic views handoff.
	assert.equal(
		SETUP_PACK_REPAIR,
		"npx codictator setup --repair --pack typescript",
	);
	assert.equal(SETUP_PACK_FRESH, "npx codictator setup --pack typescript");
	const empty = setupHandoffLines(true);
	assert.ok(
		empty.includes(
			"Setup complete — core rules only. No language packs installed.",
		),
	);
	assert.ok(
		empty.includes(
			"To add a language pack, run exactly one line and press Enter:",
		),
	);
	assert.ok(empty.includes(`  ${SETUP_PACK_REPAIR}`));
	assert.ok(empty.includes("To install the VS Code extension, run:"));
	assert.ok(
		empty.includes("  code --install-extension codictator.codictator-vscode"),
	);
	const full = setupHandoffLines(false);
	assert.ok(!full.some((line) => line.includes("No language packs installed")));
	assert.ok(!full.some((line) => line.includes("npx codictator setup")));
});

test("[§4.19.6] the command table routes setup and USAGE names it", async () => {
	// SPEC §4.19.2: setup is a routed command; the usage line lists it.
	assert.equal(COMMANDS["setup"], handleSetup);
	assert.ok(USAGE.includes("<init|setup|install-hooks|"));
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const routed = await runCommand({
			argv: ["setup", "--bogus"],
			cwd: repo.dir,
		});
		assert.equal(routed.ok, true);
		if (routed.ok) {
			assert.equal(routed.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup on an old Node fails CDX-E002", async () => {
	// SPEC §4.19.6 step 1: the Node floor runs before the human gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleSetup(req([], repo.dir, false, "v20.0.0"));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E002");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup install layout pins the engine outside npm repos", async () => {
	// SPEC §4.19.4: npm repos install at the root; other repos get
	// .codictator/tool/package.json with the exact engine pin.
	const npmRepo = createTempRepo({ "package.json": '{"name":"x"}' });
	try {
		const steps: Array<SetupStep> = [];
		const laid = await setupInstallLayout(
			req([], npmRepo.dir),
			npmRepo.dir,
			steps,
		);
		assert.equal(laid.ok, true);
		if (laid.ok) {
			assert.equal(laid.value.dirRel, ".");
			assert.equal(laid.value.lockRel, "package-lock.json");
		}
	} finally {
		npmRepo.cleanup();
	}
	const plain = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const laid = await setupInstallLayout(
			req([], plain.dir, false, undefined, "y"),
			plain.dir,
			steps,
			{ isTty: () => true },
		);
		assert.equal(laid.ok, true);
		if (!laid.ok) {
			return;
		}
		assert.equal(laid.value.dirRel, ".codictator/tool");
		const manifest = readFileSync(
			`${plain.dir}/.codictator/tool/package.json`,
			"utf8",
		);
		assert.ok(manifest.includes('"codictator"'));
		const again = await setupInstallLayout(
			req([], plain.dir, false, undefined, "y"),
			plain.dir,
			steps,
			{ isTty: () => true },
		);
		assert.equal(again.ok, true);
	} finally {
		plain.cleanup();
	}
});

test("[§4.19.6] setup install fails closed without a lockfile", async () => {
	// SPEC §4.19.6 step 5: no lockfile means npm ci cannot run — CDX-E003
	// before any spawn.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir),
			repo.dir,
			{ dir: repo.dir, lockRel: "package-lock.json", dirRel: "." },
			steps,
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup gitignore step records the guarantee", async () => {
	// SPEC §4.19.6 step 3: the step wrapper pushes the gitignore outcome.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const ran = await setupGitignoreStep(req([], repo.dir), repo.dir, steps);
		assert.equal(ran.ok, true);
		assert.equal(steps.length, 1);
		assert.equal(steps[0]?.step, "gitignore");
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] effective packs mirror flags then the written config", async () => {
	// SPEC §4.19.6 step 8: explicit --pack flags win; otherwise the
	// written config owns it; missing or malformed config means empty.
	const flagged = createTempRepo({ "README.md": "hi" });
	try {
		assert.equal(
			await hasEffectivePacks(flagged.dir, flagsWithPacks(["typescript"])),
			true,
		);
		assert.equal(
			await hasEffectivePacks(flagged.dir, flagsWithPacks([])),
			false,
		);
	} finally {
		flagged.cleanup();
	}
	const packed = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": '{"packs":["typescript"]}',
	});
	try {
		assert.equal(await hasEffectivePacks(packed.dir, flagsWithPacks([])), true);
	} finally {
		packed.cleanup();
	}
	const bare = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": '{"packs":[]}',
	});
	try {
		assert.equal(await hasEffectivePacks(bare.dir, flagsWithPacks([])), false);
	} finally {
		bare.cleanup();
	}
	const broken = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": "not json",
	});
	try {
		assert.equal(
			await hasEffectivePacks(broken.dir, flagsWithPacks([])),
			false,
		);
	} finally {
		broken.cleanup();
	}
});

test("[§4.19.6] setup init sequence writes the shared plan tail", async () => {
	// SPEC §4.13.1: init and setup run the same write-then-guard tail
	// through one helper; the helper writes the plan and guards fresh
	// config and baseline in a fresh repo.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const flags = flagsWithPacks([]);
		const sequenced = await runInitSequence(
			repo.dir,
			req([], repo.dir),
			flags,
			defaultHarnesses(flags),
			"0.0.0",
		);
		assert.equal(sequenced.ok, true);
		if (!sequenced.ok) {
			return;
		}
		assert.ok(sequenced.value.written.length > 0);
		assert.ok(
			sequenced.value.written.some(
				(entry) => entry.path === ".codictator/config.json",
			),
		);
		assert.equal(sequenced.value.baseline, true);
	} finally {
		repo.cleanup();
	}
});

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
