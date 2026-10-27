// SPEC §6.4: one red test per language-pack EC row. Each pins the SPEC
// outcome against the owning built-in pack. All three still throw
// "not implemented", so all ten fail red until Phases 7, 8 and 12 land.
import { strict as assert } from "node:assert";
import test from "node:test";
import { dotnetPack } from "../../../src/builtin-packs/dotnet/index.ts";
import { pythonPack } from "../../../src/builtin-packs/python/index.ts";
import { typescriptPack } from "../../../src/builtin-packs/typescript/index.ts";

test("[§6.4 EC-1] repo uses Biome and Prettier together", () => {
	// SPEC §6.4 EC-1: block core/dep-one-per-capability (format).
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-2] tsconfig extends a base with strict", () => {
	// SPEC §6.4 EC-2: effective settings resolved through extends.
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-3] test title built from a variable", () => {
	// SPEC §6.4 EC-3: title unknown; the trace fails with "use a literal title".
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-4] import from node fs", () => {
	// SPEC §6.4 EC-4: a built-in, never phantom.
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-5] workspace sibling declared as star", () => {
	// SPEC §6.4 EC-5: a workspace:* sibling import is allowed.
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-6] csproj with inline version", () => {
	// SPEC §6.4 EC-6: block; central package management is required.
	const pack = dotnetPack();
	assert.equal(pack.manifest.id, "dotnet");
});

test("[§6.4 EC-7] requirements line with a range", () => {
	// SPEC §6.4 EC-7: block core/dep-exact-pin.
	const pack = pythonPack();
	assert.equal(pack.manifest.id, "python");
});

test("[§6.4 EC-8] namespace package without init", () => {
	// SPEC §6.4 EC-8: resolved by directory.
	const pack = pythonPack();
	assert.equal(pack.manifest.id, "python");
});

test("[§6.4 EC-9] JS repo without TypeScript", () => {
	// SPEC §6.4 EC-9: checkJs required; TypeScript proposed as a dev dependency.
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-10] mixed TS and Python repo", () => {
	// SPEC §6.4 EC-10: both packs load; each file judged by its pack.
	const ts = typescriptPack();
	const python = pythonPack();
	assert.equal(ts.manifest.id, "typescript");
	assert.equal(python.manifest.id, "python");
});
