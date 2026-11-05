// SPEC §4.19.3 + §4.2 EC-11: the launcher passes the resolved engine's
// manifest version to main, so hook-path validation sees the installed
// version instead of the "0.0.0" placeholder. An unreadable manifest falls
// back to the two-argument call, which keeps the placeholder and fails
// closed downstream — never an allow.
import { strict as assert } from "node:assert";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LAUNCHER_TEXT } from "../../../src/cli/plan-launcher.ts";
import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..");
}

function workspaceRoot(): string {
	return path.resolve(packageRoot(), "..", "..");
}

interface Fixture {
	readonly dir: string;
	readonly record: string;
	cleanup(): void;
}

// A temp repo holding the generated launcher text plus a fake engine that
// records how main was called. The manifest version is fixed per case, so
// no test couples to the repo's own release version.
function installFixture(manifest: string | undefined): Fixture {
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-launcher-"));
	const record = path.join(dir, "record.json");
	try {
		mkdirSync(path.join(dir, ".codictator", "bin"), { recursive: true });
		writeFileSync(
			path.join(dir, ".codictator", "bin", "run.mjs"),
			LAUNCHER_TEXT,
			"utf8",
		);
		const engineDir = path.join(
			dir,
			"node_modules",
			"codictator",
			"dist",
			"cli",
		);
		mkdirSync(engineDir, { recursive: true });
		writeFileSync(
			path.join(engineDir, "main.js"),
			[
				`import { writeFileSync } from "node:fs";`,
				`export async function main(...args) {`,
				`  writeFileSync(process.env.CODICTATOR_TEST_RECORD, JSON.stringify({ count: args.length, version: args[2] === undefined ? null : args[2] }), "utf8");`,
				`  return 0;`,
				`}`,
				``,
			].join("\n"),
			"utf8",
		);
		if (manifest !== undefined) {
			writeFileSync(
				path.join(dir, "node_modules", "codictator", "package.json"),
				manifest,
				"utf8",
			);
		}
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	return {
		dir,
		record,
		cleanup(): void {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

async function runGitHook(fixture: Fixture): Promise<CliResult> {
	return runNodeScript({
		nodeArgs: [
			path.join(fixture.dir, ".codictator", "bin", "run.mjs"),
			"git",
			"pre-commit",
		],
		cwd: fixture.dir,
		env: { CODICTATOR_TEST_RECORD: fixture.record },
		timeoutMs: 60000,
	});
}

async function runServeArgs(fixture: Fixture): Promise<CliResult> {
	return runNodeScript({
		nodeArgs: [
			path.join(fixture.dir, ".codictator", "bin", "run.mjs"),
			"serve",
			"--stdio",
		],
		cwd: fixture.dir,
		env: { CODICTATOR_TEST_RECORD: fixture.record },
		timeoutMs: 60000,
	});
}

function recorded(fixture: Fixture): { count: number; version: string | null } {
	const parsed: unknown = JSON.parse(readFileSync(fixture.record, "utf8"));
	assert.ok(typeof parsed === "object" && parsed !== null);
	const body = parsed as { count: unknown; version: unknown };
	assert.equal(typeof body.count, "number");
	assert.ok(typeof body.version === "string" || body.version === null);
	return {
		count: body.count as number,
		version: body.version as string | null,
	};
}

test("[§4.19.3] launcher passes the engine manifest version to main", async () => {
	// SPEC §4.2.1 EC-11: hook-path validation must see the installed engine
	// version. Before the fix the launcher called main with two arguments,
	// so every hook validated against the "0.0.0" placeholder.
	const fixture = installFixture(
		JSON.stringify({ name: "codictator", version: "9.9.9" }),
	);
	try {
		const ran = await runGitHook(fixture);
		assert.equal(ran.code, 0);
		assert.deepEqual(recorded(fixture), { count: 3, version: "9.9.9" });
	} finally {
		fixture.cleanup();
	}
});

test("[§4.19.3] launcher falls back to two arguments without a manifest", async () => {
	// An engine directory without a readable manifest keeps the old call
	// shape, so the engine still runs and fails closed on its placeholder.
	const fixture = installFixture(undefined);
	try {
		const ran = await runGitHook(fixture);
		assert.equal(ran.code, 0);
		assert.deepEqual(recorded(fixture), { count: 2, version: null });
	} finally {
		fixture.cleanup();
	}
});

test("[§4.2 EC-11] launcher falls back on a version-less manifest", async () => {
	// A manifest without a usable version is not a version: same fallback,
	// fail-closed downstream instead of a launcher crash. A corrupt
	// (unparseable) manifest needs no case: Node rejects the engine import
	// itself, so the launcher already blocks CDX-E901.
	for (const manifest of [
		JSON.stringify({ name: "codictator" }),
		JSON.stringify({ name: "codictator", version: "" }),
		JSON.stringify({ name: "codictator", version: 42 }),
	]) {
		const fixture = installFixture(manifest);
		try {
			const ran = await runGitHook(fixture);
			assert.equal(ran.code, 0);
			assert.deepEqual(recorded(fixture), { count: 2, version: null });
		} finally {
			fixture.cleanup();
		}
	}
});

test("[§4.19.5] launcher routes serve to the engine", async () => {
	// SPEC §4.19.5: `serve --stdio` reaches the engine entry like hook and
	// git words do, instead of the outside-hook CDX-E003 reply.
	const fixture = installFixture(
		JSON.stringify({ name: "codictator", version: "9.9.9" }),
	);
	try {
		const ran = await runServeArgs(fixture);
		assert.equal(ran.code, 0);
		assert.deepEqual(recorded(fixture), { count: 3, version: "9.9.9" });
	} finally {
		fixture.cleanup();
	}
});

test("[§4.19.3] checked-in launcher matches the generated text", async () => {
	// The repo's own run.mjs is generated from LAUNCHER_TEXT (§4.19.3); a
	// hand edit drifts from the template every init and regen ships.
	const seen = readFileSync(
		path.join(workspaceRoot(), ".codictator", "bin", "run.mjs"),
		"utf8",
	);
	assert.equal(seen, LAUNCHER_TEXT);
});
