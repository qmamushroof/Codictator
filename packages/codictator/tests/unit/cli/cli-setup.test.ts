// SPEC §4.19.6: setup orchestration. In-process handler calls: assertions
// read the returned Result, never stdout (the runner shares process.stdout
// with TAP).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMANDS, USAGE } from "../../../src/cli/commands.ts";
import { runCommand } from "../../../src/cli/index.ts";
import { handleSetup, SETUP_USAGE } from "../../../src/cli/setup.ts";
import { ensureGitignoreEntries } from "../../../src/cli/setup-gitignore.ts";
import {
	SETUP_PACK_FRESH,
	SETUP_PACK_REPAIR,
	setupHandoffLines,
} from "../../../src/cli/setup-handoff.ts";
import { setupNpmArgv } from "../../../src/cli/setup-install.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
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
