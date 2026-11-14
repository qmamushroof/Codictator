// SPEC §6.1 ts/no-phantom-import: a bare import resolves to a declared
// dependency or a Node built-in. Specifier matching lives in the
// ts-phantom-host sibling; relative and built-in imports never block;
// SPEC §6.4 EC-5 workspace siblings count as declared; SPEC §6.4 EC-11
// host-provided modules count as declared inside their package dir.

import type { Ports } from "../../../kernel/index.ts";
import {
	err,
	makeError,
	ok,
	parseJson,
	type Result,
} from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, type RuleBinding, readErrorFinding } from "./binding.ts";
import { baseEnforcer, isTsFile } from "./health-measures.ts";
import {
	type DeclaredNames,
	type EffectiveFile,
	effectiveFiles,
	loadEffectiveText,
} from "./pre-tool-files.ts";
import {
	type HostProvidedConfig,
	narrowHostProvidedArgs,
	phantomFindings,
} from "./ts-phantom-host.ts";

function parentDir(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
}

function collectDeclaredNames(manifest: unknown): Set<string> {
	const names = new Set<string>();
	if (
		typeof manifest !== "object" ||
		manifest === null ||
		Array.isArray(manifest)
	) {
		return names;
	}
	const record = manifest as Record<string, unknown>;
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		const entries = record[section];
		if (
			typeof entries !== "object" ||
			entries === null ||
			Array.isArray(entries)
		) {
			continue;
		}
		for (const name of Object.keys(entries)) {
			names.add(name);
		}
	}
	return names;
}

async function declaredNamesFor(
	ports: Ports,
	file: string,
): Promise<DeclaredNames> {
	// Nearest package.json walking up from the importing file; no manifest
	// means no declared dependency, so every bare import is phantom.
	// A throw reads as missing (the fake port throws for unseeded paths);
	// only a found-but-unparseable manifest reports CDX-E903.
	let dir = parentDir(file);
	for (let depth = 0; depth < 25; depth += 1) {
		const candidate = dir === "" ? "package.json" : `${dir}/package.json`;
		let raw: Uint8Array | undefined;
		try {
			const loaded = await ports.fs.read(candidate);
			if (!loaded.ok) {
				if (dir === "") {
					return { names: new Set<string>(), broken: undefined };
				}
				dir = parentDir(dir);
				continue;
			}
			raw = loaded.value;
		} catch {
			if (dir === "") {
				return { names: new Set<string>(), broken: undefined };
			}
			dir = parentDir(dir);
			continue;
		}
		const text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
		const parsed = parseJson(text);
		if (parsed.ok) {
			return { names: collectDeclaredNames(parsed.value), broken: undefined };
		}
		return { names: new Set<string>(), broken: candidate };
	}
	return { names: new Set<string>(), broken: undefined };
}

// One TS file judged for phantom imports: unreadable content and an
// unparseable manifest fail closed; the rest is specifier matching.
async function findingsForFile(
	ports: Ports,
	binding: RuleBinding,
	grants: Readonly<HostProvidedConfig["grants"]>,
	entry: EffectiveFile,
): Promise<Array<Finding>> {
	const file = entry.path;
	const early: Array<Finding> = [];
	const text = await loadEffectiveText(ports, binding, entry, early, "lines");
	if (text === undefined) {
		return early;
	}
	const declared = await declaredNamesFor(ports, file);
	const findings: Array<Finding> = [];
	if (declared.broken !== undefined) {
		findings.push(
			readErrorFinding(
				binding,
				declared.broken,
				makeError(
					"CDX-E903",
					`package.json above ${file} is unparseable`,
					"Fix the nearest package.json so it parses, then reload.",
				),
				"read",
			),
		);
	}
	// Import specifiers come from the lexer, never a regex, so
	// specifiers inside strings, comments and fixture text never
	// count; non-literal dynamics yield nothing to judge.
	for (const found of phantomFindings(
		binding,
		file,
		text,
		declared.names,
		grants,
	)) {
		findings.push(found);
	}
	return findings;
}

// SPEC §6.1 ts/no-phantom-import: a bare import resolves to a declared
// dependency or a Node built-in. Relative and built-in imports never
// block; SPEC §6.4 EC-5 workspace siblings count as declared.
export function resolveTsNoPhantomImport(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const hostProvided = narrowHostProvidedArgs(decl.id, decl.args);
	if (!hostProvided.ok) {
		return err(hostProvided.error);
	}
	const grants = hostProvided.value.grants;
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const entry of effectiveFiles(ctx, binding.scopeGlobs)) {
				if (!isTsFile(entry.path)) {
					continue;
				}
				for (const found of await findingsForFile(
					ports,
					binding,
					grants,
					entry,
				)) {
					findings.push(found);
				}
			}
			return findings;
		}),
	);
}
