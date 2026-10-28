// SPEC §6.1 ts/no-phantom-import: a bare import resolves to a declared
// dependency or a Node built-in. Self-contained (§3.3); the built-in list
// mirrors the §6.1 supply. Relative and built-in imports never block;
// SPEC §6.4 EC-5 workspace siblings count as declared.

import type { Ports } from "../../../kernel/index.ts";
import {
	makeError,
	ok,
	parseJson,
	type Result,
} from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { blankComments } from "./health-lex.ts";
import { baseEnforcer, isTsFile } from "./health-measures.ts";

// SPEC §6.4 EC-4: a built-in, never phantom. Mirrors the §6.1 supply list
// (builtin-packs/typescript), duplicated here because §3.3 forbids the
// packs module from importing the pack supplies.
const NODE_BUILTINS: ReadonlyArray<string> = [
	"assert",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"domain",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"sys",
	"timers",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
];

function isBuiltinSpecifier(spec: string): boolean {
	if (spec.startsWith("node:")) {
		return true;
	}
	const base = spec.split("/", 1)[0] ?? "";
	return NODE_BUILTINS.includes(base);
}

function isRelativeSpecifier(spec: string): boolean {
	return (
		spec.startsWith("./") ||
		spec.startsWith("../") ||
		spec.startsWith("/") ||
		spec === "." ||
		spec === ".."
	);
}

function specBase(spec: string): string {
	if (spec.startsWith("@")) {
		return spec.split("/", 2).join("/");
	}
	return spec.split("/", 1)[0] ?? "";
}

function extractSpecifiers(blanked: string): Array<string> {
	const specs: Array<string> = [];
	for (const match of blanked.matchAll(
		/\b(?:from|import\s*\(|require\s*\(|import)\s*["']([^"']+)["']/g,
	)) {
		const spec = match[1] ?? "";
		if (spec.length > 0) {
			specs.push(spec);
		}
	}
	return [...new Set(specs)].sort();
}

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
): Promise<{
	readonly names: Set<string>;
	readonly broken: string | undefined;
}> {
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

// SPEC §6.1 ts/no-phantom-import: a bare import resolves to a declared
// dependency or a Node built-in. Relative and built-in imports never
// block; SPEC §6.4 EC-5 workspace siblings count as declared.
export function resolveTsNoPhantomImport(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isTsFile(file)) {
					continue;
				}
				const loaded = await readLossyText(ports.fs, file);
				if (!loaded.ok) {
					findings.push(readErrorFinding(binding, file, loaded.error, "read"));
					continue;
				}
				const declared = await declaredNamesFor(ports, file);
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
				const lineStarts: Array<number> = [0];
				for (let index = 0; index < loaded.value.text.length; index += 1) {
					if (loaded.value.text.charAt(index) === "\n") {
						lineStarts.push(index + 1);
					}
				}
				for (const spec of extractSpecifiers(
					blankComments(loaded.value.text),
				)) {
					if (isRelativeSpecifier(spec) || isBuiltinSpecifier(spec)) {
						continue;
					}
					if (!declared.names.has(specBase(spec))) {
						const at = loaded.value.text.indexOf(spec);
						let line = 1;
						for (const start of lineStarts) {
							if (start > at) {
								break;
							}
							line += 1;
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
				}
			}
			return findings;
		}),
	);
}
