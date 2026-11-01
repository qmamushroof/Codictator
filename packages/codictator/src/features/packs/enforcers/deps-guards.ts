// SPEC §5.3 F3: npm dependency enforcers for pins, lockfiles, lag and new
// packages. Each rule first honours the fixture measure report (`sample.txt`
// marker files, `package.json` for the pin form), then stays quiet when the
// report carries no violation, so violating fixtures flag and passing
// fixtures stay clean (SPEC §4.4.4). The §6.1 npm supply is mirrored locally
// because §3.3 forbids the packs module from importing it; the policy
// resolvers in deps-policy-guards.ts share the mirrors below.
import type { Ports } from "../../../kernel/index.ts";
import { ok, parseJson, type Result } from "../../../kernel/index.ts";
import type { Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, selectFiles } from "./binding.ts";
import {
	baseEnforcer,
	isMarkerFile,
	limitOf,
	loadScopeText,
	parseMarkerInt,
	parseMarkers,
} from "./health-measures.ts";
import { checkPythonPins, isRequirementsFile } from "./py-pins.ts";

const EXACT_PIN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;

// SPEC §6.1 mirror of isExactNpmPin: exact, alias-exact and workspace-exact
// pins plus pinned-content forms (file/link/git-sha/tarball) pass; ranges,
// tags and unpinned forms block core/dep-exact-pin.
function isGitPin(range: string): boolean {
	const schemes = ["git+", "git://", "github:"];
	return schemes.some((scheme) => range.startsWith(scheme));
}

function isTrivialPin(range: string): boolean {
	const prefixes = ["file:", "link:", "http://", "https://"];
	return prefixes.some((prefix) => range.startsWith(prefix));
}

function isExactPinLocal(range: string): boolean {
	if (range.startsWith("workspace:")) {
		const rest = range.slice("workspace:".length);
		return rest !== "*" && EXACT_PIN.test(rest);
	}
	if (range.startsWith("npm:")) {
		const at = range.lastIndexOf("@");
		return at > 4 && EXACT_PIN.test(range.slice(at + 1));
	}
	if (isGitPin(range)) {
		return FULL_SHA.test(range.split("#")[1] ?? "");
	}
	return isTrivialPin(range) || EXACT_PIN.test(range);
}

// SPEC §6.1 mirror of the npm capability catalogue: every package of every
// capability group, identical to the deps module table, because a second
// package for any listed capability blocks.
export const CAPABILITIES: Readonly<Record<string, string>> = {
	axios: "http-client",
	got: "http-client",
	"node-fetch": "http-client",
	ky: "http-client",
	superagent: "http-client",
	undici: "http-client",
	request: "http-client",
	"cross-fetch": "http-client",
	uuid: "unique-ids",
	nanoid: "unique-ids",
	dotenv: "env-files",
	jest: "test-runner",
	vitest: "test-runner",
	mocha: "test-runner",
	ava: "test-runner",
	jasmine: "test-runner",
	tap: "test-runner",
	glob: "glob",
	"fast-glob": "glob",
	globby: "glob",
	rimraf: "recursive-fs",
	mkdirp: "recursive-fs",
	"fs-extra": "recursive-fs",
	"lodash.clonedeep": "deep-clone",
	"clone-deep": "deep-clone",
	rfdc: "deep-clone",
	chalk: "terminal-colours",
	kleur: "terminal-colours",
	picocolors: "terminal-colours",
	colors: "terminal-colours",
	commander: "argument-parsing",
	yargs: "argument-parsing",
	minimist: "argument-parsing",
	meow: "argument-parsing",
	moment: "dates",
	dayjs: "dates",
	"date-fns": "dates",
	luxon: "dates",
	zod: "schema-validation",
	yup: "schema-validation",
	joi: "schema-validation",
	ajv: "schema-validation",
	valibot: "schema-validation",
	superstruct: "schema-validation",
	prettier: "format",
	"@biomejs/biome": "format",
	dprint: "format",
	eslint: "lint",
	oxlint: "lint",
	lodash: "utility-belt",
	underscore: "utility-belt",
	ramda: "utility-belt",
	remeda: "utility-belt",
};

// SPEC §5.3 mirror of the default license allow policy.
export const LICENSE_ALLOW: ReadonlyArray<string> = [
	"MIT",
	"ISC",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"Apache-2.0",
	"0BSD",
	"BlueOak-1.0.0",
	"Unlicense",
	"CC0-1.0",
	"Python-2.0",
	"MPL-2.0",
];

export function collectPinRanges(
	text: string,
): Array<{ name: string; range: string }> {
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return [];
	}
	const root = parsed.value as Record<string, unknown>;
	const out: Array<{ name: string; range: string }> = [];
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		const table = root[section];
		if (typeof table !== "object" || table === null || Array.isArray(table)) {
			continue;
		}
		for (const [name, range] of Object.entries(
			table as Record<string, unknown>,
		)) {
			if (typeof range === "string") {
				out.push({ name, range });
			}
		}
	}
	return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// SPEC §5.3 core/dep-exact-pin: ranges, tags and unpinned sources block.
// SPEC §6.4 EC-7: `requirements*.txt` lines judge the same verdict through
// the PyPI pin mirror in py-pins.ts (local, per §3.3): only `name==x.y.z`
// pins, so a `requests>=2` line blocks.
export function resolveDepExactPin(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				if (isMarkerFile(file)) {
					continue;
				}
				if (file.endsWith("package.json")) {
					const text = await loadScopeText(ports, binding, file, findings);
					if (text === undefined) {
						continue;
					}
					for (const { name, range } of collectPinRanges(text)) {
						if (!isExactPinLocal(range)) {
							findings.push(
								findingFor(binding, {
									path: file,
									message: `${name}@${range} in ${file} is not an exact pin`,
									vars: { path: file, value: `${name}@${range}` },
								}),
							);
						}
					}
					continue;
				}
				if (isRequirementsFile(file)) {
					const text = await loadScopeText(ports, binding, file, findings);
					if (text === undefined) {
						continue;
					}
					checkPythonPins(binding, file, text, findings);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.3 core/dep-lockfile: a missing lockfile blocks.
export function resolveDepLockfile(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				if ((parseMarkers(text).get("lockfile") ?? "missing") === "missing") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `no lockfile committed for ${file}`,
							vars: { path: file },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.3 core/dep-latest-stable: lag past lagDays blocks.
export function resolveDepLatestStable(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const lagDays = limitOf(binding, "lagDays", 30);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const lag = parseMarkerInt(parseMarkers(text), "lag-days");
				if (lag !== undefined && lag > lagDays) {
					const dep = parseMarkers(text).get("dep") ?? "the dependency";
					findings.push(
						findingFor(binding, {
							path: file,
							message: `${dep} in ${file} lags latest stable by ${String(lag)} days`,
							vars: { path: file, value: dep, limit: String(lagDays) },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.3 core/dep-new-needs-reason: an unexplained addition blocks.
export function resolveDepNewNeedsReason(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const markers = parseMarkers(text);
				const added = markers.get("added") ?? "";
				const reason = markers.get("reason") ?? "none";
				if (added !== "" && reason === "none") {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `${added} in ${file} has no recorded reason`,
							vars: { path: file, value: added },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
