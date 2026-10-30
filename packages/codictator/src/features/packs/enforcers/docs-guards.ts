// SPEC §5.10: F10 documentation enforcers. Doc placement judges the real
// scope paths like the records guard (SPEC §4.9.2); the remaining rules
// first honour the fixture measure report (`sample.txt` marker files), then
// stay quiet when the report carries no violation, so violating fixtures
// flag and passing fixtures stay clean (SPEC §4.4.4).
import type { Ports } from "../../../kernel/index.ts";
import { isFixturePath, ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	type RuleBinding,
	selectFiles,
	tunableStringList,
} from "./binding.ts";
import {
	baseEnforcer,
	isMarkerFile,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";

const ROOT_DOCS: ReadonlySet<string> = new Set([
	"README.md",
	"AGENTS.md",
	"CLAUDE.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md",
	"SECURITY.md",
	"CODE_OF_CONDUCT.md",
]);

// Doc rules judge markdown prose and the fixture measure reports. Other
// files carry no doc signals; reading them only pays a parse for nothing
// and invents findings from code identifiers (a doc count in `utf8Bytes`,
// a link-shaped string in a test fake).
export function isDocScopeFile(file: string): boolean {
	return isMarkerFile(file) || file.toLowerCase().endsWith(".md");
}

// SPEC §5.10 core/doc-placement: a markdown file outside its placed
// locations flags. Mirrors the records guard (SPEC §4.9.2); the rule's
// allowedGlobs tunable adds locations. Fixture goldens document
// themselves where CONVENTIONS places them (packages/codictator/fixtures,
// SPEC §4.5.7), like the secret scanner's fixture skip.
export function resolveDocPlacement(
	decl: EnforcerDecl,
	rule: PackRule,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const allowed = tunableStringList(binding, "allowedGlobs") ?? [];
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const found = placementFinding(binding, file, allowed);
				if (found !== undefined) {
					findings.push(found);
				}
			}
			return findings;
		}),
	);
}

function placementFinding(
	binding: RuleBinding,
	file: string,
	allowed: ReadonlyArray<string>,
): Finding | undefined {
	const outside = (message: string): Finding =>
		findingFor(binding, {
			path: file,
			message,
			vars: { path: file },
		});
	if (!file.endsWith(".md")) {
		return undefined;
	}
	if (isFixturePath(file)) {
		return undefined;
	}
	if (file === "docs/HISTORY.md" || file === "docs/BUGS.md") {
		return outside(`record folder needs no top-level file: ${file}`);
	}
	if (!file.includes("/") && ROOT_DOCS.has(file)) {
		return undefined;
	}
	if (/^docs\/[^/]+\.md$/.test(file) || /^docs\/[^/]+\/.+/.test(file)) {
		return undefined;
	}
	if (/^packages\/[^/]+\/README\.md$/.test(file)) {
		return undefined;
	}
	if (allowed.some((glob) => file === glob)) {
		return undefined;
	}
	return outside(`doc outside its placed locations: ${file}`);
}

// SPEC §5.10 core/doc-one-level: a doc nested below docs/<NAME>/ flags.
export function resolveDocOneLevel(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const declared = parseMarkers(text).get("path") ?? file;
				const match = /^docs\/([^/]+)\/([^/]+)\//.exec(declared);
				const folder = match?.[1] ?? "";
				if (match !== null && folder !== "HISTORY" && folder !== "BUGS") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc nested below docs/${folder}/: ${declared}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.10 core/doc-router-leaf: a folder with no router leaf flags.
export function resolveDocRouterLeaf(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				if ((parseMarkers(text).get("router") ?? "") === "missing") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `doc folder with no router leaf in ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §4.9.2 core/doc-no-corpus-counts: a corpus count flags. The
// sentence shape is SPEC-owned: this/the corpus|repository|docs|spec|prd|
// folder has|contains|holds|consists of N. Anything else — validation
// numbers in history entries, SPEC citations, code identifiers — is not
// a corpus count, so ad-hoc digit regexes must not stand in for it.
const CORPUS_COUNT =
	/\b(this|the)\s+(corpus|repository|repos|docs?|spec|prd|folder)\s+(has|contains|holds|consists of)\s+\d+/i;

// SPEC §5.10 core/doc-no-corpus-counts: a corpus count flags.
export function resolveDocNoCorpusCounts(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || /no counts/i.test(text)) {
					continue;
				}
				const found = corpusFinding(binding, file, text);
				if (found !== undefined) {
					findings.push(found);
				}
			}
			return findings;
		}),
	);
}

function corpusFinding(
	binding: RuleBinding,
	file: string,
	text: string,
): Finding | undefined {
	if (!CORPUS_COUNT.test(text)) {
		return undefined;
	}
	return findingFor(binding, {
		path: file,
		message: `corpus count in ${file}`,
		vars: { path: file },
	});
}

// SPEC §5.10 core/doc-single-owner: a fact with two owners flags.
export function resolveDocSingleOwner(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (!isDocScopeFile(file)) {
					continue;
				}
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined) {
					continue;
				}
				const owners = parseMarkerInt(parseMarkers(text), "owners");
				if (owners !== undefined && owners > 1) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `fact with two owners in ${file}`,
							vars: { path: file, value: String(owners) },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
