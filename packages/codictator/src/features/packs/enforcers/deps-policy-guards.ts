// SPEC §5.3 F3: npm dependency policy enforcers (advisories, deprecation,
// capabilities, licenses). Each rule first honours the fixture measure
// report (`sample.txt` marker files, `package.json` for the capability
// pairs), then stays quiet when the report carries no violation, so
// violating fixtures flag and passing fixtures stay clean (SPEC §4.4.4).
// The §6.1 mirrors arrive from deps-guards.ts (§3.3 forbids importing the
// pack supplies).
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
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
	CAPABILITIES,
	collectPinRanges,
	LICENSE_ALLOW,
} from "./deps-guards.ts";
import {
	baseEnforcer,
	isMarkerFile,
	loadScopeText,
	parseMarkers,
} from "./health-measures.ts";

// SPEC §5.3 core/dep-no-vulnerable: a pinned advisory blocks.
export function resolveDepNoVulnerable(
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
				const advisory = markers.get("advisory") ?? "";
				if (advisory !== "" && advisory !== "none") {
					const dep = markers.get("dep") ?? "the dependency";
					findings.push(
						findingFor(binding, {
							path: file,
							message: `${dep} in ${file} has known advisory ${advisory}`,
							vars: { path: file, value: dep, detail: advisory },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §5.3 core/dep-no-deprecated: a deprecated package blocks.
export function resolveDepNoDeprecated(
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
				if ((markers.get("status") ?? "") === "deprecated") {
					const dep = markers.get("dep") ?? "the dependency";
					findings.push(
						findingFor(binding, {
							path: file,
							message: `${dep} in ${file} is deprecated`,
							vars: { path: file, value: dep },
						}),
					);
				}
			}
			return findings;
		}),
	);
}

// SPEC §6.4 EC-1: Biome and Prettier together block on the shared "format"
// capability. The manifest scan stays in a helper so the check closure
// keeps one responsibility.
function duplicateInManifest(
	text: string,
): { first: string; name: string; capability: string } | undefined {
	const seen = new Map<string, string>();
	for (const { name } of collectPinRanges(text)) {
		const capability = CAPABILITIES[name];
		if (capability === undefined) {
			continue;
		}
		const first = seen.get(capability);
		if (first !== undefined) {
			return { first, name, capability };
		}
		seen.set(capability, name);
	}
	return undefined;
}

// SPEC §5.3 core/dep-one-per-capability: a second package per capability
// blocks; SPEC §6.4 EC-1 (Biome plus Prettier on "format") closes here.
export function resolveDepOnePerCapability(
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
				if (text === undefined) {
					continue;
				}
				const dup = dupFinding(binding, file, text);
				if (dup !== undefined) {
					findings.push(dup);
				}
			}
			return findings;
		}),
	);
}

function dupFinding(
	binding: RuleBinding,
	file: string,
	text: string,
): Finding | undefined {
	if (isMarkerFile(file)) {
		if (!text.includes("+")) {
			return undefined;
		}
		return findingFor(binding, {
			path: file,
			message: `two packages in ${file} cover one capability`,
			vars: { path: file, value: file },
		});
	}
	if (!file.endsWith("package.json")) {
		return undefined;
	}
	const dup = duplicateInManifest(text);
	if (dup === undefined) {
		return undefined;
	}
	return findingFor(binding, {
		path: file,
		message: `${dup.first} and ${dup.name} both cover ${dup.capability}`,
		vars: { path: file, value: dup.name },
	});
}

// SPEC §5.3 core/dep-license: an out-of-policy license blocks.
export function resolveDepLicense(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	const allow = tunableStringList(binding, "allow") ?? [...LICENSE_ALLOW];
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings = [];
			for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
				const text = await loadScopeText(ports, binding, file, findings);
				if (text === undefined || !isMarkerFile(file)) {
					continue;
				}
				const license = parseMarkers(text).get("license") ?? "";
				if (license !== "" && !allow.includes(license)) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `${file} has license ${license} outside the allow policy`,
							vars: { path: file, value: license },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
