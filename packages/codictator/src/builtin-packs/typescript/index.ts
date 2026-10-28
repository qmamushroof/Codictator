// SPEC §4.4.2 and §6: the typescript built-in pack (language rules plus
// ecosystem driver and extractors). Rule data lives in pack.json (SPEC
// §7.3) and loads through the pack loader; this entry exposes the pack
// identity with the §6.1 supplies the arch, testing and engine phases
// consume (import extractor, measures, titles, patterns, naming, strict).
import type { Pack } from "../../kernel/index.ts";

export {
	extractImports,
	matchWordAt,
	skipTrivia,
	typescriptExtractor,
} from "./extract.ts";
export {
	blankCode,
	isTypeScriptFile,
	lineAtIndex,
	lineStartsFor,
	TYPESCRIPT_SOURCE_EXTENSIONS,
	toPosixPath,
} from "./lex.ts";
export type { FunctionSpan } from "./measures.ts";
export {
	findDeadExports,
	findExportedNames,
	measureCyclomatic,
	measureFunctionSizes,
} from "./measures.ts";
export {
	checkTypeScriptFileName,
	isFrameworkReservedName,
	isTestFileName,
} from "./naming.ts";
export type { TextMark } from "./patterns.ts";
export {
	ASSERTION_TOKENS,
	countAssertions,
	findSkipMarkers,
	findSuppressions,
	SKIP_MARKERS,
	SUPPRESSION_TOKENS,
} from "./patterns.ts";
export {
	collectDeclaredNames,
	isBareSpecifier,
	isBuiltinSpecifier,
	isPhantomSpecifier,
	isRelativeSpecifier,
	isWorkspaceAllowed,
	matchTsPaths,
	normalizeImportPath,
	resolveRelativeSpecifier,
} from "./resolve.ts";
export {
	isJavaScriptOnlyRepo,
	missingCheckJsFlags,
	missingStrictFlags,
	proposesTypescript,
	resolveEffectiveOptions,
	TYPESCRIPT_STRICT_FLAGS,
} from "./strict.ts";
export type { TestRunner, TestTitle } from "./titles.ts";
export { extractTestTitles, testFilterArg } from "./titles.ts";

// SPEC §6: typescript pack manifest with its driver and extractors. The
// rules stay owned by pack.json and load via `loadBuiltinPack`; the pack
// value here carries the identity the language-pack contract asserts while
// steps 7.2–7.7 wire the enforcers that consume these supplies.
export function typescriptPack(): Pack {
	return {
		manifest: {
			id: "typescript",
			version: "0.0.0",
			description:
				"Codictator TypeScript/JavaScript built-in pack (SPEC §6.1).",
			rules: [],
			enforcers: [],
			drivers: [],
			extractors: [],
			measures: [],
			capabilities: [],
			assets: [],
			maxWaiverDays: 90,
		},
		enforcers: [],
		drivers: [],
		assets: [],
	};
}
