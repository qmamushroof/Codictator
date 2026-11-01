// SPEC §6.3 + §6.4 EC-8: the Python import extractor. Throw-only stub for
// step 12.4; mirrors the typescript extractor entry shape so the 12.4
// contract tests pin it red until namespace-by-directory resolution lands.
// Not re-exported from the pack index, so nothing wires it yet.
export interface PythonImportRef {
	readonly from: string;
	readonly to: string;
	readonly line: number;
}

export interface PythonExtractor {
	readonly language: "python";
	readonly extensions: ReadonlyArray<string>;
	readonly extract: (from: string, text: string) => Array<PythonImportRef>;
}

// SPEC §6.3: absolute `import a.b` and relative `from . import c` edges,
// with namespace packages resolved by directory (EC-8).
export function extractPythonImports(
	from: string,
	text: string,
): Array<PythonImportRef> {
	throw new Error(
		`not implemented: SPEC §6.3 python import extractor for ${from} with ${text.length} chars`,
	);
}

// SPEC §6.4 EC-8: a namespace package without `__init__.py` resolves by
// directory, never by marker file.
export function resolvePythonModule(
	specifier: string,
	files: ReadonlyArray<string>,
): string | undefined {
	throw new Error(
		`not implemented: SPEC §6.4 EC-8 namespace resolution for ${specifier} over ${files.length} files`,
	);
}

// SPEC §6.3: the extractor entry, shaped like the typescript extractor so
// the arch checks judge it by the same contract once it lands.
export function pythonExtractor(): PythonExtractor {
	throw new Error("not implemented: SPEC §6.3 python extractor entry");
}
