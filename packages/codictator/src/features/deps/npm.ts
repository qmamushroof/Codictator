// SPEC §6.1 driver `npm`: manifest parsing, exact-pin forms and toolchain
// files. Lockfile sync lives in lockfile.ts and the owned `.npmrc` entry in
// npmrc.ts. Everything here is pure over caller-supplied text; ports stay at
// the enforcer layer (SPEC §3.3), so a Driver instance that could do I/O
// waits for gate-closure wiring with ports.
import {
	err,
	makeError,
	ok,
	parseJson,
	type Result,
} from "../../kernel/index.ts";
import { field, isJsonRecord } from "./fields.ts";

export const NPM_ECOSYSTEM = "npm";

// SPEC §4.8.1: dependency kinds; toolchains (.nvmrc, packageManager) ride
// the same verdict path with kind "toolchain".
export type NpmDepKind = "prod" | "dev" | "peer" | "toolchain";

export interface NpmDependency {
	readonly name: string;
	readonly range: string;
	readonly kind: NpmDepKind;
}

// SPEC §6.1: exact pin is a full x.y.z[-pre]. Workspace, file/link and
// npm-alias forms carry their own pinnedness; git URLs need a full SHA.
export type NpmPinForm =
	| "exact"
	| "range"
	| "tag"
	| "alias-exact"
	| "alias-range"
	| "workspace-exact"
	| "workspace-range"
	| "file"
	| "link"
	| "git-sha"
	| "git-unpinned"
	| "tarball-url";

const EXACT_PIN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;

function stripWorkspacePrefix(range: string): string | undefined {
	if (range === "workspace:*") {
		return "*";
	}
	if (range.startsWith("workspace:")) {
		return range.slice("workspace:".length);
	}
	return undefined;
}

export function classifyNpmRange(range: string): NpmPinForm {
	const workspace = stripWorkspacePrefix(range);
	if (workspace !== undefined) {
		return EXACT_PIN.test(workspace) ? "workspace-exact" : "workspace-range";
	}
	if (range.startsWith("file:")) {
		return "file";
	}
	if (range.startsWith("link:")) {
		return "link";
	}
	if (range.startsWith("npm:")) {
		const at = range.lastIndexOf("@");
		const version = at < 4 ? "" : range.slice(at + 1);
		return EXACT_PIN.test(version) ? "alias-exact" : "alias-range";
	}
	if (
		range.startsWith("git+") ||
		range.startsWith("git://") ||
		range.startsWith("github:")
	) {
		const hash = range.split("#")[1] ?? "";
		return FULL_SHA.test(hash) ? "git-sha" : "git-unpinned";
	}
	if (range.startsWith("http://") || range.startsWith("https://")) {
		return "tarball-url";
	}
	if (EXACT_PIN.test(range)) {
		return "exact";
	}
	if (
		range === "*" ||
		range === "latest" ||
		range === "" ||
		/^[a-zA-Z][0-9A-Za-z.-]*$/.test(range)
	) {
		return "tag";
	}
	return "range";
}

// SPEC §4.8.5: ranges, tags, *, latest and unpinned git/alias/workspace
// forms block core/dep-exact-pin. In-repo file:/link: forms, full-SHA git
// URLs and tarball URLs are pinned content; EC-7 allows the SHA form.
export function isExactNpmPin(range: string): boolean {
	const form = classifyNpmRange(range);
	return (
		form === "exact" ||
		form === "alias-exact" ||
		form === "workspace-exact" ||
		form === "file" ||
		form === "link" ||
		form === "git-sha" ||
		form === "tarball-url"
	);
}

// SPEC §4.8.5 EC-7: versionless sources skip latest-stable, reported as
// "unversioned source".
export function isUnversionedNpmSource(range: string): boolean {
	const form = classifyNpmRange(range);
	return (
		form === "file" ||
		form === "link" ||
		form === "git-sha" ||
		form === "tarball-url"
	);
}

function stringTable(value: unknown): Record<string, string> {
	if (!isJsonRecord(value)) {
		return {};
	}
	const table: Record<string, string> = {};
	for (const key of Object.keys(value).sort()) {
		const entry = value[key];
		if (typeof entry === "string") {
			table[key] = entry;
		}
	}
	return table;
}

export interface NpmManifest {
	readonly dependencies: ReadonlyArray<NpmDependency>;
	readonly engines: Readonly<Record<string, string>>;
	readonly peerRanges: Readonly<Record<string, string>>;
	readonly packageManager: string | undefined;
	readonly workspaces: ReadonlyArray<string>;
}

function collectManifestDeps(
	root: Record<string, unknown>,
): Array<NpmDependency> {
	const dependencies: Array<NpmDependency> = [];
	const sections: ReadonlyArray<[string, NpmDepKind]> = [
		["dependencies", "prod"],
		["devDependencies", "dev"],
		["optionalDependencies", "prod"],
	];
	for (const [section, kind] of sections) {
		for (const [name, range] of Object.entries(
			stringTable(field(root, section)),
		)) {
			dependencies.push({ name, range, kind });
		}
	}
	dependencies.sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	);
	return dependencies;
}

function collectWorkspaces(
	root: Record<string, unknown>,
): ReadonlyArray<string> {
	const raw = field(root, "workspaces");
	const workspaces: Array<string> = [];
	const pushStrings = (value: unknown): void => {
		if (!Array.isArray(value)) {
			return;
		}
		for (const entry of value) {
			if (typeof entry === "string") {
				workspaces.push(entry);
			}
		}
	};
	if (isJsonRecord(raw)) {
		pushStrings(field(raw, "packages"));
	} else {
		pushStrings(raw);
	}
	return workspaces;
}

// SPEC §6.1: dependencies, devDependencies, optionalDependencies and
// overrides supply pins; peerDependencies and engines are compatibility
// declarations (EC-6), never pins.
export function parsePackageJson(text: string): Result<NpmManifest> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	if (!isJsonRecord(parsed.value)) {
		return err(
			makeError(
				"CDX-E101",
				"package.json must hold a JSON object at its root",
				"Point the manifest at the package root object.",
			),
		);
	}
	const root = parsed.value;
	const rawManager = field(root, "packageManager");
	return ok({
		dependencies: collectManifestDeps(root),
		engines: stringTable(field(root, "engines")),
		peerRanges: stringTable(field(root, "peerDependencies")),
		packageManager: typeof rawManager === "string" ? rawManager : undefined,
		workspaces: collectWorkspaces(root),
	});
}

// SPEC §6.1 toolchain: .nvmrc exact, packageManager exact (npm@x.y.z).
export function parseToolchainFiles(
	nvmrc: string | undefined,
	packageManager: string | undefined,
): ReadonlyArray<NpmDependency> {
	const toolchains: Array<NpmDependency> = [];
	if (nvmrc !== undefined) {
		toolchains.push({
			name: "node",
			range: nvmrc.trim().replace(/^v/, ""),
			kind: "toolchain",
		});
	}
	if (packageManager !== undefined) {
		toolchains.push({
			name: "packageManager",
			range: packageManager.trim(),
			kind: "toolchain",
		});
	}
	return toolchains;
}

export function isExactToolchainPin(range: string): boolean {
	if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range)) {
		return true;
	}
	return /^[a-zA-Z][0-9A-Za-z_-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
		range,
	);
}
