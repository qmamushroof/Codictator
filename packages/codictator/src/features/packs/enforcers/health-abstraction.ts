// SPEC §5.6 core/no-speculative-abstraction: no interface or abstract type
// with one implementation (§6.1: exactly one implements/extends; test
// doubles and module entries exempt; CONVENTIONS: ports and the §3.4
// contracts exempt). Marker files carry the fixture measure report; source
// files are scanned lexer-light over blankCode output, so commented-out
// types never count. Findings sort by path and line, so the verdict is
// deterministic (§4.3.6).
import type { Ports, Result } from "../../../kernel/index.ts";
import { ok } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	isTestPath,
	type RuleBinding,
	selectFiles,
} from "./binding.ts";
import { blankCode } from "./health-lex.ts";
import {
	baseEnforcer,
	isEntryFile,
	isMarkerFile,
	isTsFile,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §6.1: an abstraction is an interface or an abstract class; each
// implements entry and each extends clause counts one implementation.
const ABSTRACTION_PATTERN =
	/\binterface\s+([A-Za-z_$][\w$]*)|\babstract\s+class\s+([A-Za-z_$][\w$]*)/g;
const IMPLEMENTS_PATTERN =
	/\bimplements\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/g;
const EXTENDS_PATTERN = /\bextends\s+([A-Za-z_$][\w$]*)/g;

function leafOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? path : path.slice(slash + 1);
}

// SPEC §5.6 + §3.4: ports files hold the contracts, module entries are the
// public surface, and test trees carry doubles; none of them is judged.
function isExemptAbstractionFile(path: string): boolean {
	return (
		isTestPath(path) ||
		isEntryFile(path) ||
		leafOf(path).toLowerCase() === "ports.ts"
	);
}

function lineOfBlanked(blanked: string, at: number): number {
	let line = 1;
	for (let index = 0; index < at && index < blanked.length; index += 1) {
		if (blanked.charAt(index) === "\n") {
			line += 1;
		}
	}
	return line;
}

interface DeclaredAbstraction {
	readonly name: string;
	readonly file: string;
	readonly line: number;
}

function compareFindings(left: Finding, right: Finding): number {
	const leftPath = left.path ?? "";
	const rightPath = right.path ?? "";
	if (leftPath < rightPath) {
		return -1;
	}
	if (leftPath > rightPath) {
		return 1;
	}
	return (left.line ?? 0) - (right.line ?? 0);
}

function collectAbstractions(
	blanked: string,
	file: string,
	declared: Map<string, DeclaredAbstraction>,
	implementations: Map<string, number>,
): void {
	for (const match of blanked.matchAll(ABSTRACTION_PATTERN)) {
		const name = match[1] ?? match[2] ?? "";
		if (name === "" || declared.has(name)) {
			continue;
		}
		declared.set(name, {
			name,
			file,
			line: lineOfBlanked(blanked, match.index ?? 0),
		});
	}
	for (const match of blanked.matchAll(IMPLEMENTS_PATTERN)) {
		for (const part of (match[1] ?? "").split(",")) {
			const reference = part.trim();
			if (reference !== "") {
				implementations.set(
					reference,
					(implementations.get(reference) ?? 0) + 1,
				);
			}
		}
	}
	for (const match of blanked.matchAll(EXTENDS_PATTERN)) {
		const reference = match[1] ?? "";
		if (reference !== "") {
			implementations.set(reference, (implementations.get(reference) ?? 0) + 1);
		}
	}
}

// SPEC §5.6: exactly one implements/extends of a declared abstraction
// flags; zero or several stay clean. Exempt files neither declare nor
// implement, so contracts, entries and doubles never judge.
function judgeAbstractions(
	binding: RuleBinding,
	declared: ReadonlyMap<string, DeclaredAbstraction>,
	implementations: ReadonlyMap<string, number>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const name of [...declared.keys()].sort()) {
		if ((implementations.get(name) ?? 0) !== 1) {
			continue;
		}
		const site = declared.get(name);
		if (site === undefined) {
			continue;
		}
		findings.push(
			findingFor(binding, {
				path: site.file,
				line: site.line,
				message: `speculative abstraction ${name} has one implementation at ${site.file}:${String(site.line)}`,
				vars: { path: site.file, line: String(site.line), value: name },
			}),
		);
	}
	return findings;
}

export function resolveNoSpeculativeAbstraction(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			const declared = new Map<string, DeclaredAbstraction>();
			const implementations = new Map<string, number>();
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if (isMarkerFile(file)) {
					const markers = parseMarkers(text);
					if (
						(markers.get("test-double") ?? "").trim().toLowerCase() === "true"
					) {
						continue;
					}
					if (parseMarkerInt(markers, "implementations") === 1) {
						const name = markers.get("interface") ?? "type";
						findings.push(
							findingFor(binding, {
								path: file,
								line: 1,
								message: `speculative abstraction ${name} has one implementation in ${file}`,
								vars: { path: file, line: "1", value: name },
							}),
						);
					}
					continue;
				}
				if (!isTsFile(file) || isExemptAbstractionFile(file)) {
					continue;
				}
				collectAbstractions(blankCode(text), file, declared, implementations);
			}
			findings.push(...judgeAbstractions(binding, declared, implementations));
			findings.sort(compareFindings);
			return findings;
		}),
	);
}
