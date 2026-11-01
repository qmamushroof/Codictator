// SPEC §6.3 python/no-phantom-import: a top-level import resolves to a
// declared dependency, the standard library, or a first-party package.
// Self-contained (§3.3); the stdlib list, the requirements scan and the
// pyproject scan mirror the §6.3 supply locally. Relative imports never
// block; first-party means the top segment maps to a scope file by module
// path or by directory (namespace packages need no `__init__.py`,
// SPEC §6.4 EC-8). Only the canonical `requirements.txt` and
// `pyproject.toml` declare; other requirements variant names still judge
// pins under core/dep-exact-pin but do not declare here.
import type { Ports } from "../../../kernel/index.ts";
import { makeError, ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { baseEnforcer } from "./health-measures.ts";
import {
	extractPythonSpecifiers,
	isPythonFile,
	isPythonStdlib,
	isRelativePythonSpec,
	pythonTopSegment,
} from "./py-lex.ts";
import { collectPyprojectNames, parsePythonRequirements } from "./py-pins.ts";

function parentDir(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
}

async function declaredNamesFor(
	ports: Ports,
	file: string,
): Promise<{
	readonly names: Set<string>;
	readonly broken: string | undefined;
}> {
	// Nearest requirements.txt or pyproject.toml walking up from the
	// importing file; no manifest means no declared dependency, so every
	// third-party import is phantom. A throw reads as missing (the fake
	// port throws for unseeded paths); a requirements line that parses as
	// no requirement reports CDX-E903.
	let dir = parentDir(file);
	for (let depth = 0; depth < 25; depth += 1) {
		const reqCandidate =
			dir === "" ? "requirements.txt" : `${dir}/requirements.txt`;
		const tomlCandidate =
			dir === "" ? "pyproject.toml" : `${dir}/pyproject.toml`;
		let reqText: string | undefined;
		let tomlText: string | undefined;
		try {
			const loaded = await ports.fs.read(reqCandidate);
			if (loaded.ok) {
				reqText = new TextDecoder("utf-8", { fatal: false }).decode(
					loaded.value,
				);
			}
		} catch {
			reqText = undefined;
		}
		try {
			const loaded = await ports.fs.read(tomlCandidate);
			if (loaded.ok) {
				tomlText = new TextDecoder("utf-8", { fatal: false }).decode(
					loaded.value,
				);
			}
		} catch {
			tomlText = undefined;
		}
		if (reqText !== undefined || tomlText !== undefined) {
			const names = new Set<string>();
			if (tomlText !== undefined) {
				for (const name of collectPyprojectNames(tomlText)) {
					names.add(name);
				}
			}
			if (reqText !== undefined) {
				const parsed = parsePythonRequirements(reqText);
				if (parsed.brokenLine !== undefined) {
					return { names: new Set<string>(), broken: reqCandidate };
				}
				for (const req of parsed.reqs) {
					names.add(req.name);
				}
			}
			return { names, broken: undefined };
		}
		if (dir === "") {
			return { names: new Set<string>(), broken: undefined };
		}
		dir = parentDir(dir);
	}
	return { names: new Set<string>(), broken: undefined };
}

// A first-party package maps to a scope file by module path, so `app`
// claims `app.py` at the root or nested, never `myapp.py`.
function firstPartyModuleFile(top: string, normalized: string): boolean {
	return (
		normalized === `${top}.py` ||
		normalized === `${top}.pyi` ||
		normalized.endsWith(`/${top}.py`) ||
		normalized.endsWith(`/${top}.pyi`)
	);
}

// A first-party package maps to a scope file by its marker module, so
// namespace packages without `__init__.py` need the directory match below.
function firstPartyInitFile(top: string, normalized: string): boolean {
	return (
		normalized === `${top}/__init__.py` ||
		normalized === `${top}/__init__.pyi` ||
		normalized.endsWith(`/${top}/__init__.py`) ||
		normalized.endsWith(`/${top}/__init__.pyi`)
	);
}

// A first-party package maps to a scope file by directory, so namespace
// packages without `__init__.py` still count. Matching is slash-bounded,
// so `app` never claims `myapp/` or `appdata/`.
function firstPartyDir(top: string, normalized: string): boolean {
	return normalized.startsWith(`${top}/`) || normalized.includes(`/${top}/`);
}

// A first-party package maps to a scope file by module path or by
// directory, so namespace packages without `__init__.py` still count.
// Matching is slash-bounded, so `app` never claims `myapp/` or `appdata/`.
function isFirstParty(top: string, files: ReadonlyArray<string>): boolean {
	for (const file of files) {
		const normalized = file.replaceAll("\\", "/");
		if (
			firstPartyModuleFile(top, normalized) ||
			firstPartyInitFile(top, normalized) ||
			firstPartyDir(top, normalized)
		) {
			return true;
		}
	}
	return false;
}

// Judge one scope file for phantom imports: unreadable files and an
// unparseable nearest manifest fail closed, otherwise every undeclared,
// non-stdlib, non-first-party top level blocks.
async function checkPythonFileForPhantoms(
	binding: RuleBinding,
	ports: Ports,
	file: string,
	scopeFiles: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	if (!isPythonFile(file)) {
		return findings;
	}
	const loaded = await readLossyText(ports.fs, file);
	if (!loaded.ok) {
		findings.push(readErrorFinding(binding, file, loaded.error, "read"));
		return findings;
	}
	const declared = await declaredNamesFor(ports, file);
	if (declared.broken !== undefined) {
		findings.push(
			readErrorFinding(
				binding,
				declared.broken,
				makeError(
					"CDX-E903",
					`requirements.txt above ${file} is unparseable`,
					"Fix the nearest requirements.txt so it parses, then reload.",
				),
				"read",
			),
		);
	}
	// Import specifiers come from the lexer, never a regex over
	// raw text, so specifiers inside strings, comments and
	// fixture text never count.
	findings.push(
		...phantomFindings(
			binding,
			file,
			loaded.value.text,
			declared.names,
			scopeFiles,
		),
	);
	return findings;
}

// SPEC §6.3 python/no-phantom-import: a top-level import resolves to a
// declared dependency, the standard library, or a first-party package.
// Relative and stdlib imports never block.
export function resolvePythonNoPhantomImport(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			const scopeFiles = [...ctx.scope.files].sort();
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				findings.push(
					...(await checkPythonFileForPhantoms(
						binding,
						ports,
						file,
						scopeFiles,
					)),
				);
			}
			return findings;
		}),
	);
}

function phantomFindings(
	binding: RuleBinding,
	file: string,
	text: string,
	declared: ReadonlySet<string>,
	scopeFiles: ReadonlyArray<string>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	const seen = new Set<string>();
	for (const { spec, line } of extractPythonSpecifiers(text)) {
		if (seen.has(spec)) {
			continue;
		}
		seen.add(spec);
		if (isRelativePythonSpec(spec)) {
			continue;
		}
		const top = pythonTopSegment(spec);
		if (
			isPythonStdlib(top) ||
			isFirstParty(top, scopeFiles) ||
			declared.has(top)
		) {
			continue;
		}
		findings.push(
			findingFor(binding, {
				path: file,
				line,
				message: `phantom import ${spec} in ${file}:${String(line)}`,
				vars: { path: file, line: String(line), value: spec },
			}),
		);
	}
	return findings;
}
