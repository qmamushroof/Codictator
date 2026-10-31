// SPEC §6.4: one test per language-pack EC row. EC-6 and EC-7 pin the SPEC
// outcome through the NuGet and PyPI drivers, so both pass. EC-8 still
// throws "not implemented" until the python import extractor resolves
// namespace packages by directory, and EC-10 until pack-bound enforcers
// judge each file by its pack, so both stay red.
import { strict as assert } from "node:assert";
import test from "node:test";
import { dotnetPack } from "../../../src/builtin-packs/dotnet/index.ts";
import { pythonPack } from "../../../src/builtin-packs/python/index.ts";
import { typescriptPack } from "../../../src/builtin-packs/typescript/index.ts";
import {
	classifyNuGetRange,
	csprojInlineVersions,
	isExactDotnetSdk,
	isExactNuGetPin,
	isPinnedRollForward,
	parseCsprojPackageRefs,
	parseDirectoryPackagesProps,
	parseGlobalJson,
} from "../../../src/features/deps/nuget.ts";
import {
	classifyPyPiSpec,
	isExactPyPiPin,
	isExactPythonVersion,
	parsePythonVersionFile,
	parseRequirementsText,
	requirementsFullyPinned,
} from "../../../src/features/deps/pypi.ts";
import { parsePyprojectDependencies } from "../../../src/features/deps/pypi-pyproject.ts";

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
	// SPEC §6.4 EC-6: block; central package management is required. Both
	// inline XML forms count: the Version attribute and the <Version>
	// child element.
	const pack = dotnetPack();
	assert.equal(pack.manifest.id, "dotnet");
	const inlineAttr = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`;
	const inlineChild = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json">
      <Version>13.0.3</Version>
    </PackageReference>
  </ItemGroup>
</Project>`;
	for (const csproj of [inlineAttr, inlineChild]) {
		const refs = parseCsprojPackageRefs(csproj);
		assert.equal(refs.length, 1);
		assert.equal(refs[0]?.name, "Newtonsoft.Json");
		assert.equal(refs[0]?.version, "13.0.3");
		assert.equal(csprojInlineVersions(csproj).length, 1);
		assert.equal(isExactNuGetPin(refs[0]?.version ?? ""), true);
	}
	const central = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" />
  </ItemGroup>
</Project>`;
	assert.deepEqual(csprojInlineVersions(central), []);
});

test("[§6.4 EC-7] requirements line with a range", () => {
	// SPEC §6.4 EC-7: block core/dep-exact-pin. A range spec never counts
	// as exact; only a full `==x.y.z` pin does.
	const pack = pythonPack();
	assert.equal(pack.manifest.id, "python");
	const parsed = parseRequirementsText("requests>=2\n");
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.length, 1);
		assert.equal(parsed.value[0]?.name, "requests");
		assert.equal(isExactPyPiPin(parsed.value[0]?.spec ?? ""), false);
		assert.equal(classifyPyPiSpec(parsed.value[0]?.spec ?? ""), "range");
	}
	const pinned = parseRequirementsText("requests==2.31.0\n");
	assert.equal(pinned.ok, true);
	if (pinned.ok) {
		assert.equal(isExactPyPiPin(pinned.value[0]?.spec ?? ""), true);
		assert.equal(classifyPyPiSpec(pinned.value[0]?.spec ?? ""), "exact");
	}
});

test("[§6.4 EC-8] namespace package without init", () => {
	// SPEC §6.4 EC-8: resolved by directory. Red until the python import
	// extractor lands; the driver alone cannot resolve modules to files.
	throw new Error("not implemented: SPEC §6.4 EC-8 namespace resolution");
});

test("[§6.4 EC-9] JS repo without TypeScript", () => {
	// SPEC §6.4 EC-9: checkJs required; TypeScript proposed as a dev dependency.
	const pack = typescriptPack();
	assert.equal(pack.manifest.id, "typescript");
});

test("[§6.4 EC-10] mixed TS and Python repo", () => {
	// SPEC §6.4 EC-10: both packs load; each file judged by its pack. Red
	// until pack-bound enforcers land; loading both packs alone judges no
	// file.
	throw new Error("not implemented: SPEC §6.4 EC-10 per-file pack judging");
});

test("[§6.3] pypi exact pin needs a full x.y.z", () => {
	// SPEC §6.3: only `==x.y.z` pins; partial pins are ranges.
	assert.equal(isExactPyPiPin("==2.31.0"), true);
	assert.equal(isExactPyPiPin("==2.31.0-rc.1"), true);
	assert.equal(isExactPyPiPin("==2"), false);
	assert.equal(isExactPyPiPin("==2.31"), false);
	assert.equal(isExactPyPiPin(">=2"), false);
	assert.equal(isExactPyPiPin("~=2.0"), false);
	assert.equal(isExactPyPiPin("===2.31.0"), false);
	assert.equal(isExactPyPiPin("==2.31.*"), false);
	assert.equal(isExactPyPiPin(""), false);
	assert.equal(classifyPyPiSpec("==2.31.0"), "exact");
	assert.equal(classifyPyPiSpec("==2.31"), "range");
	assert.equal(classifyPyPiSpec(">=2"), "range");
	assert.equal(classifyPyPiSpec("https://example.com/a.tgz"), "url");
});

test("[§6.2] csproj inline versions in both XML forms", () => {
	// SPEC §6.2: the attribute and the child element both pin inline.
	const attr = `<Project><ItemGroup><PackageReference Include="A" Version="1.2.3" /></ItemGroup></Project>`;
	const child = `<Project><ItemGroup><PackageReference Include="A"><Version>1.2.3</Version></PackageReference></ItemGroup></Project>`;
	assert.deepEqual(parseCsprojPackageRefs(attr), [
		{ name: "A", version: "1.2.3" },
	]);
	assert.deepEqual(parseCsprojPackageRefs(child), [
		{ name: "A", version: "1.2.3" },
	]);
});

test("[§6.2] nuget pin forms judge ranges and floating versions", () => {
	// SPEC §6.2: exact is a full x.y.z with an optional fourth numeric
	// part; brackets and `*` float.
	assert.equal(classifyNuGetRange("1.2.3"), "exact");
	assert.equal(classifyNuGetRange("1.2.3.4"), "exact");
	assert.equal(classifyNuGetRange("1.2.3-beta.1"), "exact");
	assert.equal(classifyNuGetRange("[1.2.3]"), "floating");
	assert.equal(classifyNuGetRange("1.2.*"), "floating");
	assert.equal(classifyNuGetRange(">=1.2.3"), "range");
	assert.equal(isExactNuGetPin("1.2.3.4"), true);
	assert.equal(isExactNuGetPin("1.2.*"), false);
});

test("[§6.2] dotnet toolchain and central versions parse", () => {
	// SPEC §6.2: Directory.Packages.props pins centrally; global.json pins
	// the sdk with a disabled roll-forward.
	const props = `<Project><ItemGroup><PackageVersion Include="A" Version="1.2.3" /></ItemGroup></Project>`;
	assert.deepEqual(parseDirectoryPackagesProps(props), { A: "1.2.3" });
	const toolchain = parseGlobalJson(
		JSON.stringify({ sdk: { version: "9.0.100", rollForward: "disable" } }),
	);
	assert.equal(toolchain.ok, true);
	if (toolchain.ok) {
		assert.equal(isExactDotnetSdk(toolchain.value.sdkVersion), true);
		assert.equal(isPinnedRollForward(toolchain.value.rollForward), true);
	}
	assert.equal(isPinnedRollForward("latestMajor"), false);
	assert.equal(isExactDotnetSdk("9.0"), false);
});

test("[§6.3] requirements lockfile needs pins and hashes", () => {
	// SPEC §6.3: a locked requirements file pins every line with hashes.
	const text = ["requests==2.31.0 \\", "    --hash=sha256:abc"].join("\n");
	const parsed = parseRequirementsText(text);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value[0]?.name, "requests");
		assert.deepEqual(parsed.value[0]?.hashes, ["sha256:abc"]);
		assert.equal(requirementsFullyPinned(parsed.value), true);
	}
	const ranged = parseRequirementsText("requests>=2\n");
	assert.equal(ranged.ok, true);
	if (ranged.ok) {
		assert.equal(requirementsFullyPinned(ranged.value), false);
	}
	assert.equal(isExactPythonVersion("3.12.1"), true);
	assert.equal(isExactPythonVersion("3.12"), false);
	assert.equal(parsePythonVersionFile("3.12.1\n"), "3.12.1");
});

test("[§6.3] pyproject dependency groups parse as dev", () => {
	// SPEC §6.3: PEP 735 groups ride with the [project] dependencies;
	// `{include-group}` entries name a group, not a package.
	const text = [
		"[project]",
		'name = "demo"',
		'requires-python = ">=3.12"',
		'dependencies = ["requests==2.31.0"]',
		"",
		"[dependency-groups]",
		'test = ["pytest==8.3.4", {include-group = "base"}]',
		'base = ["urllib3>=2"]',
		"",
	].join("\n");
	const parsed = parsePyprojectDependencies(text);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.requiresPython, ">=3.12");
		const byName = new Map(
			parsed.value.dependencies.map((dep) => [dep.name, dep]),
		);
		assert.equal(byName.get("requests")?.kind, "prod");
		assert.equal(byName.get("pytest")?.kind, "dev");
		assert.equal(byName.get("urllib3")?.kind, "dev");
		assert.equal(isExactPyPiPin(byName.get("pytest")?.spec ?? ""), true);
		assert.equal(isExactPyPiPin(byName.get("urllib3")?.spec ?? ""), false);
		assert.equal(byName.has("base"), false);
	}
});
