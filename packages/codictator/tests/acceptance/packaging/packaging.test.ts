// SPEC §10.2: packaging tests. The npm tarball file list equals the §9.2
// allowlist and the .vsix contains no node_modules. Each test pins its
// real manifest assertion, then executes the not-yet-implemented packaging
// contract, so both fail red until the release phase lands.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../src/cli/index.ts";

function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..");
}

function vscodeRoot(): string {
	return path.resolve(packageRoot(), "..", "vscode");
}

test("[§10.2] npm tarball file list equals the allowlist", async () => {
	// SPEC §9.2: the published tarball contains only dist/, schema/,
	// README.md and LICENSE (the allowlist in files).
	const raw: unknown = JSON.parse(
		readFileSync(path.join(packageRoot(), "package.json"), "utf8"),
	);
	assert.equal(typeof raw, "object");
	assert.ok(raw !== null);
	const files = (raw as { readonly files?: unknown }).files;
	assert.deepEqual(files, ["dist/", "schema/", "README.md", "LICENSE"]);
	await runCommand({ argv: ["pack", "--dry-run"], cwd: packageRoot() });
});

test("[§10.2] vsix contains no node_modules", async () => {
	// SPEC §10.2: the .vsix contains no node_modules; the extension ships
	// zero runtime dependencies and the dist/extension.cjs entry.
	const raw: unknown = JSON.parse(
		readFileSync(path.join(vscodeRoot(), "package.json"), "utf8"),
	);
	assert.equal(typeof raw, "object");
	assert.ok(raw !== null);
	const manifest = raw as {
		readonly main?: unknown;
		readonly dependencies?: unknown;
	};
	assert.equal(manifest.main, "dist/extension.cjs");
	assert.equal(manifest.dependencies, undefined);
	await runCommand({ argv: ["vsix", "package"], cwd: vscodeRoot() });
});
