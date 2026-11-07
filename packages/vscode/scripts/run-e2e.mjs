// SPEC §4.20: the `npm run test:extension` runner. Builds are owned by
// the npm script; this module asserts the built bits exist, stands up the
// tmp fixture repo from e2e-fixture.mjs, and drives @vscode/test-electron
// against it with the host cwd deliberately left at the repo root. The
// --smoke-only flag (or CODICTATOR_E2E_SMOKE_ONLY=1) stops after the
// fixture wiring so local runs need no display or download.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createE2eFixture, removeE2eFixture } from "./e2e-fixture.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..", "..", "..");
const vscodePackageDir = resolve(scriptsDir, "..");
const enginePackageDir = join(repoRoot, "packages", "codictator");

function report(line) {
	process.stdout.write(`${line}\n`);
}

function fail(message) {
	process.stderr.write(`test:extension: ${message}\n`);
	process.exitCode = 1;
}

function smokeOnly() {
	return (
		process.argv.includes("--smoke-only") ||
		process.env.CODICTATOR_E2E_SMOKE_ONLY === "1"
	);
}

function vscodeVersion() {
	const pinned = process.env.CODICTATOR_E2E_VSCODE_VERSION;
	return typeof pinned === "string" && pinned !== "" ? pinned : "stable";
}

async function loadTestElectron() {
	// @vscode/test-electron is a root devDependency (SPEC §2.2) hoisted to
	// the workspace root by npm; the nearest manifest above this script is
	// packages/vscode, so the bare specifier would read as phantom. Import
	// through the declared install path instead.
	const testElectronEntry = pathToFileURL(
		join(
			repoRoot,
			"node_modules",
			"@vscode",
			"test-electron",
			"out",
			"index.js",
		),
	).href;
	return import(testElectronEntry);
}

function hostLaunchArgs(fixtureDir, profileDir) {
	// The profile stays under the OS tmp dir beside the fixture, so a
	// host run never writes `.vscode-test/` into the repo checkout.
	return [
		fixtureDir,
		"--user-data-dir",
		join(profileDir, "user-data"),
		"--extensions-dir",
		join(profileDir, "extensions"),
	];
}

async function runExtensionHost(fixtureDir, profileDir) {
	const { downloadAndUnzipVSCode, runTests } = await loadTestElectron();
	const executablePath = await downloadAndUnzipVSCode({
		cachePath: join(tmpdir(), "codictator-e2e-vscode"),
		version: vscodeVersion(),
	});
	return runTests({
		extensionDevelopmentPath: vscodePackageDir,
		extensionTestsPath: join(
			vscodePackageDir,
			"tests",
			"e2e",
			"suite",
			"index.mjs",
		),
		extensionTestsEnv: { CODICTATOR_E2E_FIXTURE: fixtureDir },
		launchArgs: hostLaunchArgs(fixtureDir, profileDir),
		vscodeExecutablePath: executablePath,
	});
}

async function main() {
	const extensionDist = join(vscodePackageDir, "dist", "extension.cjs");
	const engineEntry = join(enginePackageDir, "dist", "cli", "main.js");
	for (const built of [extensionDist, engineEntry]) {
		if (!existsSync(built)) {
			fail(`missing ${built}; run npm run build first`);
			return;
		}
	}
	const fixture = await createE2eFixture({ enginePackageDir });
	const profileDir = mkdtempSync(join(tmpdir(), "codictator-e2e-profile-"));
	const hostCwd = process.cwd();
	if (fixture.dir === hostCwd) {
		removeE2eFixture(fixture.dir);
		removeE2eFixture(profileDir);
		fail(`fixture dir equals host cwd`);
		return;
	}
	report(`fixture: ${fixture.dir}`);
	report(`host cwd: ${hostCwd}`);
	report(`engine: ${fixture.engineVersion}`);
	try {
		if (smokeOnly()) {
			report(`smoke-only: fixture wiring ok, no VS Code launch`);
			return;
		}
		process.exitCode = await runExtensionHost(fixture.dir, profileDir);
	} finally {
		removeE2eFixture(fixture.dir);
		removeE2eFixture(profileDir);
	}
}

void main().catch((error) => {
	fail(error instanceof Error ? error.message : String(error));
});
