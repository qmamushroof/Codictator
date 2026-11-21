// SPEC §4.8.5: live dependency judging for the four verdicts that first read
// fixture marker reports only (BUG-0107). L3 judges the staged npm manifest:
// the lockfile beside or above it, the dependencies HEAD does not carry yet,
// and, hermetically, the registry snapshot a repo holds at
// .codictator/cache/registry/npm.json (§4.8.4, §7.12). An enforcer never
// calls the net port (§4.3.6), and a repo with no snapshot gets no registry
// verdict here: fetching it is the deps command's job, and §3.3 keeps the
// packs module from importing it, so the few snapshot fields it needs are
// mirrored.
import { type Ports, parseJson, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import { type EnforcerDecl, field, isRecord } from "../manifest.ts";
import { findingFor, type RuleBinding } from "./binding.ts";
import { collectPinRanges } from "./deps-guards.ts";
import { isMarkerFile } from "./health-markers.ts";
import { loadScopeText, parseMarkers } from "./health-measures.ts";
import {
	forEachMarkerText,
	type MarkerRealArgs,
	markerRealGuard,
} from "./marker-scan.ts";

export interface ManifestFile {
	readonly path: string;
	readonly deps: ReadonlyArray<{
		readonly name: string;
		readonly range: string;
	}>;
}

const SNAPSHOT_PATH = ".codictator/cache/registry/npm.json";
const LOCKFILES = [
	"package-lock.json",
	"npm-shrinkwrap.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
] as const;

// One resolver for a dependency rule: the fixture marker report judges
// through `mark`, the real staged manifests through `live`.
export function depRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	mark: (
		binding: RuleBinding,
		file: string,
		markers: Map<string, string>,
	) => Finding | undefined,
	live: (
		args: MarkerRealArgs,
		manifests: ReadonlyArray<ManifestFile>,
	) => Promise<void>,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		(args) =>
			forEachMarkerText(
				args.ports,
				args.binding,
				args.files,
				args.findings,
				(file, text) => {
					const found = mark(args.binding, file, parseMarkers(text));
					if (found !== undefined) {
						args.findings.push(found);
					}
				},
			),
		async (args) => {
			const manifests: Array<ManifestFile> = [];
			for (const path of args.files) {
				if (!path.endsWith("package.json") || isMarkerFile(path)) {
					continue;
				}
				const text = await loadScopeText(
					args.ports,
					args.binding,
					path,
					args.findings,
				);
				if (text !== undefined) {
					manifests.push({ path, deps: collectPinRanges(text) });
				}
			}
			await live(args, manifests);
		},
	);
}

function exactVersion(range: string): string | undefined {
	return /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(range)?.[1];
}

async function present(ports: Ports, path: string): Promise<boolean> {
	const found = await ports.fs.exists(path);
	return found.ok && found.value;
}

// The lockfile of a manifest sits in its folder or an ancestor (a workspace
// root); the nearest one wins.
async function nearestLockfile(
	ports: Ports,
	manifest: string,
): Promise<string | undefined> {
	const dirs = manifest.split("/").slice(0, -1);
	for (let depth = dirs.length; depth >= 0; depth -= 1) {
		for (const name of LOCKFILES) {
			const candidate = [...dirs.slice(0, depth), name].join("/");
			if (await present(ports, candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

// package-lock.json: the pin the lock holds for a name is the root range or,
// failing that, the nested package version (mirrors features/deps/lockfile).
function stringEntries(table: unknown): Array<[string, string]> {
	return Object.entries(isRecord(table) ? table : {}).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
}

function rootPins(packages: Record<string, unknown>): Array<[string, string]> {
	const root = field(packages, "");
	return ["dependencies", "devDependencies", "optionalDependencies"].flatMap(
		(section) =>
			stringEntries(isRecord(root) ? field(root, section) : undefined),
	);
}

function nestedPins(
	packages: Record<string, unknown>,
): Array<[string, string]> {
	return Object.entries(packages)
		.filter(([key]) => key.startsWith("node_modules/"))
		.flatMap(([key, entry]): Array<[string, string]> => {
			const version = isRecord(entry) ? field(entry, "version") : undefined;
			return typeof version === "string"
				? [[key.slice("node_modules/".length), version]]
				: [];
		});
}

function lockedPins(text: string): Map<string, string> {
	const parsed = parseJson(text);
	const packages =
		parsed.ok && isRecord(parsed.value)
			? field(parsed.value, "packages")
			: undefined;
	const pins = new Map<string, string>(
		isRecord(packages) ? rootPins(packages) : [],
	);
	for (const [name, version] of isRecord(packages)
		? nestedPins(packages)
		: []) {
		if (!pins.has(name)) {
			pins.set(name, version);
		}
	}
	return pins;
}

// SPEC §4.8.5 core/dep-lockfile: a manifest with dependencies and no
// lockfile blocks, and a package-lock.json that pins another version than an
// exact manifest pin is out of sync.
export async function judgeLockfiles(
	args: MarkerRealArgs,
	manifests: ReadonlyArray<ManifestFile>,
): Promise<void> {
	for (const manifest of manifests.filter((entry) => entry.deps.length > 0)) {
		const lock = await nearestLockfile(args.ports, manifest.path);
		const fail = (message: string): void => {
			args.findings.push(
				findingFor(args.binding, {
					path: manifest.path,
					message,
					vars: { path: manifest.path },
				}),
			);
		};
		if (lock === undefined) {
			fail(`no lockfile committed for ${manifest.path}`);
		} else if (lock.endsWith("package-lock.json")) {
			const read = await args.ports.fs.readText(lock);
			const pins = read.ok ? lockedPins(read.value) : new Map<string, string>();
			for (const { name, range } of manifest.deps) {
				const wanted = exactVersion(range);
				const locked = (pins.get(name) ?? "").replace(/^v/, "");
				if (wanted !== undefined && locked !== wanted) {
					fail(
						`${name}@${range} in ${manifest.path} is out of sync with ${lock}`,
					);
				}
			}
		}
	}
}

// SPEC §4.8.4: only the snapshot fields the two registry verdicts read.
async function readSnapshot(
	ports: Ports,
): Promise<{ advisories: unknown; packages: unknown } | undefined> {
	if (!(await present(ports, SNAPSHOT_PATH))) {
		return undefined;
	}
	const read = await ports.fs.readText(SNAPSHOT_PATH);
	const parsed = read.ok ? parseJson(read.value) : undefined;
	return parsed?.ok === true && isRecord(parsed.value)
		? {
				advisories: field(parsed.value, "advisories"),
				packages: field(parsed.value, "packages"),
			}
		: undefined;
}

// SPEC §4.8.5: a snapshot verdict per exact pin. `verdict` answers the
// finding message for one pinned name and version, or undefined.
export function judgeSnapshot(
	verdict: (
		snapshot: { advisories: unknown; packages: unknown },
		name: string,
		version: string,
		path: string,
	) => string | undefined,
): (
	args: MarkerRealArgs,
	manifests: ReadonlyArray<ManifestFile>,
) => Promise<void> {
	return async (args, manifests) => {
		const snapshot = await readSnapshot(args.ports);
		for (const manifest of snapshot === undefined ? [] : manifests) {
			for (const { name, range } of manifest.deps) {
				const version = exactVersion(range);
				const message =
					version === undefined
						? undefined
						: verdict(snapshot as never, name, version, manifest.path);
				if (message !== undefined) {
					args.findings.push(
						findingFor(args.binding, {
							path: manifest.path,
							message,
							vars: { path: manifest.path, value: name },
						}),
					);
				}
			}
		}
	};
}

export function advisoryVerdict(
	snapshot: { advisories: unknown },
	name: string,
	version: string,
	path: string,
): string | undefined {
	const ids = isRecord(snapshot.advisories)
		? field(snapshot.advisories, `${name}@${version}`)
		: undefined;
	return Array.isArray(ids) && ids.length > 0
		? `${name}@${version} in ${path} has known advisory ${ids.join(", ")}`
		: undefined;
}

export function deprecationVerdict(
	snapshot: { packages: unknown },
	name: string,
	version: string,
	path: string,
): string | undefined {
	const pkg = isRecord(snapshot.packages)
		? field(snapshot.packages, name)
		: undefined;
	const versions = isRecord(pkg) ? field(pkg, "versions") : undefined;
	const detail = isRecord(versions) ? field(versions, version) : undefined;
	return isRecord(detail) &&
		(field(detail, "deprecated") === true || field(detail, "yanked") === true)
		? `${name}@${version} in ${path} is deprecated or yanked`
		: undefined;
}
