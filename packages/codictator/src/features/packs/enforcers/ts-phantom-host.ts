// SPEC §6.4 EC-11: host-provided module grants for ts/no-phantom-import.
// Narrowing and matching live here so the enforcer entry stays thin; the
// pack manifest binds the map (§7.3: args ride along opaquely), keyed by
// package dir with a specifier list each.
import { err, ok, type Result } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import { field, isRecord } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	type RuleBinding,
	stringList,
} from "./binding.ts";
import { extractLiteralSpecifiers } from "./health-lex-imports.ts";

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

export interface HostProvidedConfig {
	readonly grants: ReadonlyArray<{
		readonly dir: string;
		readonly specs: ReadonlySet<string>;
	}>;
}

function narrowHostProvidedEntry(
	declId: string,
	dir: string,
	value: unknown,
): Result<{ readonly dir: string; readonly specs: ReadonlySet<string> }> {
	if (dir.length === 0) {
		return bindingError(declId, "needs non-empty package dirs in args");
	}
	const specs = stringList(value);
	if (
		specs === undefined ||
		specs.length === 0 ||
		specs.some((entry) => entry.length === 0)
	) {
		return bindingError(
			declId,
			`needs a non-empty specifier list for package dir "${dir}" in args`,
		);
	}
	return ok({ dir, specs: new Set(specs) });
}

function narrowHostProvidedGrants(
	declId: string,
	raw: Record<string, unknown>,
): Result<HostProvidedConfig["grants"]> {
	const grants: Array<{
		readonly dir: string;
		readonly specs: ReadonlySet<string>;
	}> = [];
	for (const dir of Object.keys(raw).sort()) {
		const narrowed = narrowHostProvidedEntry(declId, dir, field(raw, dir));
		if (!narrowed.ok) {
			return err(narrowed.error);
		}
		grants.push(narrowed.value);
	}
	return ok(grants);
}

// SPEC §6.4 EC-11: host-provided modules arrive in decl args as a package
// dir to specifier list map. Absent args mean no grant, malformed args fail
// the load (CDX-E203), so a typo never silently widens the rule.
export function narrowHostProvidedArgs(
	declId: string,
	args: unknown,
): Result<HostProvidedConfig> {
	if (args === undefined) {
		return ok({ grants: [] });
	}
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const raw = field(record.value, "hostProvided");
	if (raw === undefined) {
		return ok({ grants: [] });
	}
	if (!isRecord(raw)) {
		return bindingError(
			declId,
			'needs a "hostProvided" object in args keyed by package dir',
		);
	}
	const grants = narrowHostProvidedGrants(declId, raw);
	if (!grants.ok) {
		return err(grants.error);
	}
	return ok({ grants: grants.value });
}

function specBase(spec: string): string {
	if (spec.startsWith("@")) {
		return spec.split("/", 2).join("/");
	}
	return spec.split("/", 1)[0] ?? "";
}

function isHostProvided(
	grants: Readonly<HostProvidedConfig["grants"]>,
	file: string,
	spec: string,
): boolean {
	const normalized = file.replaceAll("\\", "/");
	const base = specBase(spec);
	return grants.some(
		(grant) =>
			(normalized === grant.dir || normalized.startsWith(`${grant.dir}/`)) &&
			grant.specs.has(base),
	);
}

// The bare-import findings: relative and built-in specifiers never block,
// host-provided grants count as declared inside their package dir, and the
// rest must resolve to a declared dependency.
export function phantomFindings(
	binding: RuleBinding,
	file: string,
	text: string,
	declared: ReadonlySet<string>,
	grants: Readonly<HostProvidedConfig["grants"]>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	const seen = new Set<string>();
	for (const { spec, line } of extractLiteralSpecifiers(text)) {
		if (seen.has(spec)) {
			continue;
		}
		seen.add(spec);
		if (isRelativeSpecifier(spec) || isBuiltinSpecifier(spec)) {
			continue;
		}
		if (isHostProvided(grants, file, spec)) {
			continue;
		}
		if (!declared.has(specBase(spec))) {
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
	return findings;
}
