// SPEC §10.2: packaging tests. The npm tarball file list equals the §9.2
// allowlist and the .vsix contains no node_modules. Each test pins its
// manifest assertions (allowlist, zero runtime dependencies, no install
// scripts), then runs the real packaging commands (npm pack --dry-run,
// vsce ls/package --no-dependencies), so a broken allowlist, a stray
// install hook or a bundled node_modules fails the gate.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..");
}

function vscodeRoot(): string {
	return path.resolve(packageRoot(), "..", "vscode");
}

function repoRoot(): string {
	return path.resolve(packageRoot(), "..", "..");
}

// shell: false stays portable by running npm's own cli under this node:
// npm_execpath when the gate runs under `npm run`, else the cli beside
// the running node (Windows layout first, then the POSIX lib layout).
function npmCli(): string {
	const fromEnv = process.env["npm_execpath"];
	if (typeof fromEnv === "string" && fromEnv !== "" && existsSync(fromEnv)) {
		return fromEnv;
	}
	const besideNode = path.join(
		path.dirname(process.execPath),
		"node_modules",
		"npm",
		"bin",
		"npm-cli.js",
	);
	if (existsSync(besideNode)) {
		return besideNode;
	}
	const libLayout = path.join(
		path.dirname(path.dirname(process.execPath)),
		"lib",
		"node_modules",
		"npm",
		"bin",
		"npm-cli.js",
	);
	if (existsSync(libLayout)) {
		return libLayout;
	}
	assert.fail("npm-cli.js not found; run the gate under npm with node+npm");
}

function vsceEntry(): string {
	return path.join(repoRoot(), "node_modules", "@vscode", "vsce", "vsce");
}

interface RunResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

function runFile(
	file: string,
	args: ReadonlyArray<string>,
	cwd: string,
): RunResult {
	try {
		const stdout = execFileSync(file, [...args], {
			cwd,
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
			timeout: 120_000,
			windowsHide: true,
		});
		return { code: 0, stdout, stderr: "" };
	} catch (error) {
		const withOutput = error as {
			readonly status?: unknown;
			readonly stdout?: unknown;
			readonly stderr?: unknown;
		};
		return {
			code: typeof withOutput.status === "number" ? withOutput.status : 1,
			stdout: typeof withOutput.stdout === "string" ? withOutput.stdout : "",
			stderr: typeof withOutput.stderr === "string" ? withOutput.stderr : "",
		};
	}
}

function readManifest(dir: string): Record<string, unknown> {
	const raw: unknown = JSON.parse(
		readFileSync(path.join(dir, "package.json"), "utf8"),
	);
	assert.equal(typeof raw, "object");
	assert.ok(raw !== null);
	return raw as Record<string, unknown>;
}

// SPEC §9.2: the published packages run no install scripts, so a
// compromised dependency cannot execute on `npm ci` or consumer install.
function assertNoInstallHooks(dir: string): void {
	const manifest = readManifest(dir);
	const scripts = manifest["scripts"];
	if (scripts === undefined) {
		return;
	}
	assert.equal(typeof scripts, "object");
	assert.ok(scripts !== null);
	const hooks = scripts as Record<string, unknown>;
	assert.equal(hooks["preinstall"], undefined);
	assert.equal(hooks["install"], undefined);
	assert.equal(hooks["postinstall"], undefined);
}

function isAllowedTarballPath(entryPath: string): boolean {
	return (
		entryPath === "package.json" ||
		entryPath === "LICENSE" ||
		entryPath === "README.md" ||
		entryPath.startsWith("dist/") ||
		entryPath.startsWith("schema/")
	);
}

test("[§10.2] npm tarball file list equals the allowlist", () => {
	// SPEC §9.2: the published tarball contains only dist/, schema/,
	// README.md and LICENSE (the allowlist in files, plus the npm-added
	// package.json), and no manifest carries an install hook. The real
	// `npm pack --dry-run --json` must exit 0 with every path allowlisted.
	const manifest = readManifest(packageRoot());
	assert.deepEqual(manifest["files"], [
		"dist/",
		"schema/",
		"README.md",
		"LICENSE",
	]);
	assertNoInstallHooks(repoRoot());
	assertNoInstallHooks(packageRoot());
	assertNoInstallHooks(vscodeRoot());
	const packed = runFile(
		process.execPath,
		[npmCli(), "pack", "--dry-run", "--json"],
		packageRoot(),
	);
	assert.equal(packed.code, 0);
	const runs: unknown = JSON.parse(packed.stdout);
	assert.ok(Array.isArray(runs));
	assert.equal(runs.length, 1);
	const run = runs[0];
	assert.equal(typeof run, "object");
	assert.ok(run !== null);
	const files = (run as { readonly files?: unknown }).files;
	assert.ok(Array.isArray(files));
	assert.ok(files.length > 0);
	let sawDist = false;
	let sawSchema = false;
	for (const entry of files) {
		assert.equal(typeof entry, "object");
		assert.ok(entry !== null);
		const entryPath = (entry as { readonly path?: unknown }).path;
		if (typeof entryPath !== "string") {
			assert.fail("tarball entry path is not a string");
		}
		assert.ok(
			isAllowedTarballPath(entryPath),
			`tarball entry outside the allowlist: ${entryPath}`,
		);
		assert.ok(
			!entryPath.includes("node_modules"),
			`tarball entry bundles node_modules: ${entryPath}`,
		);
		sawDist = sawDist || entryPath.startsWith("dist/");
		sawSchema = sawSchema || entryPath.startsWith("schema/");
	}
	assert.ok(sawDist);
	assert.ok(sawSchema);
});

test("[§10.2] vsix contains no node_modules", () => {
	// SPEC §10.2: the .vsix contains no node_modules; the extension ships
	// zero runtime dependencies and the dist/extension.cjs entry, with no
	// install hooks. The listing (`vsce ls --no-dependencies`) holds zero
	// node_modules entries and the real `vsce package --no-dependencies`
	// build exits 0. Link rewriting stays off: README links resolve at
	// release time (13.5), not in this contents gate.
	const manifest = readManifest(vscodeRoot()) as {
		readonly main?: unknown;
		readonly dependencies?: unknown;
	};
	assert.equal(manifest.main, "dist/extension.cjs");
	assert.equal(manifest.dependencies, undefined);
	assertNoInstallHooks(vscodeRoot());
	const ignore = readFileSync(path.join(vscodeRoot(), ".vscodeignore"), "utf8");
	assert.ok(ignore.includes("!dist/**"));
	assert.ok(ignore.includes("node_modules"));
	const listed = runFile(
		process.execPath,
		[vsceEntry(), "ls", "--no-dependencies"],
		vscodeRoot(),
	);
	assert.equal(listed.code, 0);
	const entries = listed.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
	assert.ok(entries.length > 0);
	assert.deepEqual(
		entries.filter((entry) => entry.includes("node_modules")),
		[],
	);
	const outDir = mkdtempSync(path.join(tmpdir(), "codictator-vsix-"));
	try {
		const out = path.join(outDir, "codictator.vsix");
		const built = runFile(
			process.execPath,
			[
				vsceEntry(),
				"package",
				"--no-dependencies",
				"--no-rewrite-relative-links",
				"-o",
				out,
			],
			vscodeRoot(),
		);
		assert.equal(built.code, 0);
		assert.ok(existsSync(out));
		assert.ok(statSync(out).size > 0);
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
});
