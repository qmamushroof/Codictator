// SPEC §6.1 + §6.4 EC-4/EC-5: specifier classes, tsconfig paths, strict-flag
// sets and title extraction. Everything here is pure string work over
// caller-supplied manifests, so no network or filesystem is touched.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	ASSERTION_TOKENS,
	checkTypeScriptFileName,
	collectDeclaredNames,
	countAssertions,
	extractTestTitles,
	findSkipMarkers,
	findSuppressions,
	isBareSpecifier,
	isBuiltinSpecifier,
	isFrameworkReservedName,
	isJavaScriptOnlyRepo,
	isPhantomSpecifier,
	isRelativeSpecifier,
	isTestFileName,
	isWorkspaceAllowed,
	matchTsPaths,
	missingCheckJsFlags,
	missingStrictFlags,
	normalizeImportPath,
	proposesTypescript,
	resolveEffectiveOptions,
	resolveRelativeSpecifier,
	SKIP_MARKERS,
	SUPPRESSION_TOKENS,
	TYPESCRIPT_STRICT_FLAGS,
	testFilterArg,
} from "../../../src/builtin-packs/typescript/index.ts";
import { field } from "../../../src/features/packs/manifest.ts";

test("[§6.4] ts specifier classes separate builtins and phantoms", () => {
	assert.equal(isBuiltinSpecifier("node:fs"), true);
	assert.equal(isBuiltinSpecifier("fs"), true);
	assert.equal(isBuiltinSpecifier("./local"), false);
	assert.equal(isRelativeSpecifier("./a"), true);
	assert.equal(isRelativeSpecifier("../a"), true);
	assert.equal(isRelativeSpecifier("/abs"), true);
	assert.equal(isRelativeSpecifier("."), true);
	assert.equal(isRelativeSpecifier("pkg"), false);
	assert.equal(isBareSpecifier("pkg/sub"), true);
	assert.equal(isBareSpecifier("./x"), false);
	assert.equal(isPhantomSpecifier("missing-pkg", new Set(["left-pad"])), true);
	assert.equal(
		isPhantomSpecifier("@scope/pkg/sub", new Set(["@scope/pkg"])),
		false,
	);
	assert.equal(isPhantomSpecifier("./x", new Set()), false);
});

test("[§6.4] ts declared names and workspace ranges read manifests", () => {
	const manifest = {
		dependencies: { a: "1.0.0" },
		devDependencies: { b: "2.0.0" },
		optionalDependencies: { c: "workspace:*" },
		peerDependencies: { d: "3.0.0" },
	};
	const declared = collectDeclaredNames(manifest);
	assert.ok(declared.has("a") && declared.has("b") && declared.has("c"));
	assert.ok(!declared.has("d"));
	assert.deepEqual(collectDeclaredNames(undefined), new Set());
	assert.equal(isWorkspaceAllowed("c", manifest), true);
	assert.equal(isWorkspaceAllowed("a", manifest), false);
	assert.equal(isWorkspaceAllowed("c", undefined), false);
});

test("[§6.1] ts import paths normalise and match tsconfig paths", () => {
	assert.equal(normalizeImportPath("a/./b/../c"), "a/c");
	assert.equal(normalizeImportPath("/x/../y"), "/y");
	assert.equal(resolveRelativeSpecifier("src/a/b.ts", "../c"), "src/c");
	assert.equal(resolveRelativeSpecifier("main.ts", "./x"), "x");
	assert.equal(matchTsPaths("@app/x", { "@app/*": ["src/*"] }, "."), "src/x");
	assert.equal(
		matchTsPaths("exact", { exact: ["lib/main"] }, "base"),
		"base/lib/main",
	);
	assert.equal(matchTsPaths("nope", { "@a/*": ["x/*"] }, "."), undefined);
	assert.equal(matchTsPaths("ab", { a: ["1"], ab: ["2"] }, "."), "2");
});

test("[§6.4] ts strict flags resolve extends chains and gaps", () => {
	const full = Object.fromEntries(
		TYPESCRIPT_STRICT_FLAGS.map((flag) => [flag, true]),
	);
	assert.deepEqual(missingStrictFlags(full), []);
	assert.ok(missingStrictFlags({}).length === TYPESCRIPT_STRICT_FLAGS.length);
	const files = {
		"tsconfig.json": JSON.stringify({
			extends: "./base.json",
			compilerOptions: { strict: true },
		}),
		"base.json": JSON.stringify({
			compilerOptions: { strict: false, noUnusedLocals: true },
		}),
	};
	const merged = resolveEffectiveOptions("tsconfig.json", files);
	assert.equal(field(merged, "strict"), true);
	assert.equal(field(merged, "noUnusedLocals"), true);
	assert.deepEqual(resolveEffectiveOptions("missing.json", files), {});
	assert.deepEqual(
		resolveEffectiveOptions("tsconfig.json", { "tsconfig.json": "{bad" }),
		{},
	);
	assert.equal(isJavaScriptOnlyRepo(["a.js", "b.jsx"]), true);
	assert.equal(isJavaScriptOnlyRepo(["a.js", "b.ts"]), false);
	assert.equal(isJavaScriptOnlyRepo([]), false);
	assert.deepEqual(missingCheckJsFlags({}), [
		"allowJs",
		"checkJs",
		...TYPESCRIPT_STRICT_FLAGS,
	]);
	assert.equal(proposesTypescript({ devDependencies: {} }), true);
	assert.equal(
		proposesTypescript({ devDependencies: { typescript: "1.0.0" } }),
		false,
	);
});

test("[§6.1] ts file names judge kebab stems and escapes", () => {
	assert.ok(checkTypeScriptFileName("src/my-file.ts").ok);
	assert.ok(!checkTypeScriptFileName("src/MyFile.ts").ok);
	assert.ok(checkTypeScriptFileName("src/my-file.test.ts").ok);
	assert.ok(!checkTypeScriptFileName("src/MyFile.test.ts").ok);
	assert.ok(checkTypeScriptFileName("src/[id].tsx").ok);
	assert.ok(checkTypeScriptFileName("src/+page.ts").ok);
	assert.ok(checkTypeScriptFileName("src/_app.ts").ok);
	assert.equal(isTestFileName("a.test.ts"), true);
	assert.equal(isTestFileName("a.ts"), false);
	assert.equal(isFrameworkReservedName("[id].tsx"), true);
	assert.equal(isFrameworkReservedName("plain.ts"), false);
});

test("[§6.1] ts patterns count assertions skips and suppressions", () => {
	assert.ok(ASSERTION_TOKENS.includes("expect("));
	assert.ok(SKIP_MARKERS.includes(".only("));
	assert.ok(SUPPRESSION_TOKENS.includes("biome-ignore"));
	const text =
		"expect(x);\nassert(y);\n// expect(z);\ntest.skip('s', () => {});\n// biome-ignore line";
	assert.equal(countAssertions(text), 2);
	const skips = findSkipMarkers(text);
	assert.equal(skips.length, 1);
	assert.equal(skips[0]?.line, 4);
	const muted = findSuppressions(text);
	assert.equal(muted.length, 1);
	assert.equal(muted[0]?.line, 5);
	assert.deepEqual(findSkipMarkers("nothing here"), []);
});

test("[§6.4] ts titles join suites and flag unknowns", () => {
	const titles = extractTestTitles(
		"describe('outer', () => {\ndescribe('inner', () => {\ntest('works', () => {});\n});\n});\nit(unknownVar, () => {});",
	);
	assert.equal(titles.length, 2);
	assert.deepEqual(titles[0]?.suite, ["outer", "inner"]);
	assert.equal(titles[0]?.literal, true);
	assert.equal(titles[1]?.literal, false);
	assert.deepEqual(testFilterArg("node", "p"), ["--test-name-pattern", "p"]);
	assert.deepEqual(testFilterArg("vitest", "p"), ["-t", "p"]);
	assert.deepEqual(testFilterArg("jest", "p"), ["-t", "p"]);
});
