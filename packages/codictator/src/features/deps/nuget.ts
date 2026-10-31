// SPEC §6.2 driver `nuget`: manifest parsing, exact-pin forms and toolchain
// files. Lockfile sync and verdicts stay at the enforcer layer, mirroring
// the npm driver split (manifest logic here, sync in lockfile.ts). All
// parsing here is pure over caller-supplied text; a Driver instance that
// reads the repo waits for gate-closure wiring with ports (SPEC §3.3).
import {
	err,
	makeError,
	ok,
	parseJson,
	type Result,
} from "../../kernel/index.ts";
import { isJsonRecord, recordField, stringField } from "./fields.ts";

export const NUGET_ECOSYSTEM = "nuget";

// SPEC §4.8.1: dependency kinds; toolchains (global.json) ride the same
// verdict path with kind "toolchain".
export type NuGetDepKind = "prod" | "dev" | "toolchain";

export interface NuGetDependency {
	readonly name: string;
	readonly version: string;
	readonly kind: NuGetDepKind;
}

// SPEC §6.2: exact pin is a full x.y.z[-pre]; NuGet additionally honours a
// fourth numeric part, which still counts as exact. Floating `*` parts and
// bracket intervals never pin.
export type NuGetPinForm = "exact" | "range" | "floating";

const NUGET_EXACT = /^\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/;
// The fourth numeric part is a .NET build revision, not a range, so it still pins exact.

export function classifyNuGetRange(range: string): NuGetPinForm {
	const trimmed = range.trim();
	if (NUGET_EXACT.test(trimmed)) {
		return "exact";
	}
	if (
		trimmed.includes("*") ||
		trimmed.startsWith("[") ||
		trimmed.startsWith("(")
	) {
		return "floating";
	}
	return "range";
}

// SPEC §4.8.5: ranges and floating versions block core/dep-exact-pin.
export function isExactNuGetPin(range: string): boolean {
	return classifyNuGetRange(range) === "exact";
}

export interface CsprojPackageRef {
	readonly name: string;
	readonly version: string | undefined;
}

const ATTR_PATTERN = /([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attrOf(tag: string, name: string): string | undefined {
	const matches = tag.matchAll(ATTR_PATTERN);
	for (const match of matches) {
		if (match[1] === name) {
			return match[2] ?? match[3];
		}
	}
	return undefined;
}

const PACKAGE_REF_PATTERN =
	/<PackageReference\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference\s*>|>)/g;

function childVersionOf(body: string): string | undefined {
	const match = /<Version\s*>\s*([^<]*?)\s*<\/Version\s*>/.exec(body);
	const version = (match?.[1] ?? "").trim();
	return version === "" ? undefined : version;
}

// SPEC §6.2: every PackageReference the build restores. An inline Version
// reads from the attribute or the `<Version>` child element, so EC-6
// rejects both XML forms; centrally managed projects carry no Version here.
export function parseCsprojPackageRefs(text: string): Array<CsprojPackageRef> {
	const refs: Array<CsprojPackageRef> = [];
	const tags = text.matchAll(PACKAGE_REF_PATTERN);
	for (const tag of tags) {
		const attrs = tag[1] ?? "";
		const body = tag[2] ?? "";
		const name = attrOf(attrs, "Include");
		if (name === undefined || name === "") {
			continue;
		}
		refs.push({
			name,
			version: attrOf(attrs, "Version") ?? childVersionOf(body),
		});
	}
	// Document order is deterministic, so the scan order is the verdict
	// order without a re-sort.
	return refs;
}

// SPEC §6.4 EC-6: an inline Version on PackageReference is not centrally
// managed; the fix names Directory.Packages.props.
export function csprojInlineVersions(text: string): Array<CsprojPackageRef> {
	return parseCsprojPackageRefs(text).filter(
		(ref) => ref.version !== undefined,
	);
}

const PACKAGE_VERSION_PATTERN = /<PackageVersion\b[^>]*>/g;

// SPEC §6.2 central package management: Directory.Packages.props pins every
// version in one place as <PackageVersion Include Version="x.y.z" />.
export function parseDirectoryPackagesProps(
	text: string,
): Record<string, string> {
	const versions: Record<string, string> = {};
	const tags = text.matchAll(PACKAGE_VERSION_PATTERN);
	for (const tag of tags) {
		const markup = tag[0] ?? "";
		const name = attrOf(markup, "Include");
		const version = attrOf(markup, "Version");
		if (name !== undefined && name !== "" && version !== undefined) {
			versions[name] = version;
		}
	}
	// Document order is deterministic, so insertion order is the verdict
	// order without a re-sort.
	return versions;
}

export interface DotnetToolchain {
	readonly sdkVersion: string | undefined;
	readonly rollForward: string | undefined;
}

// SPEC §6.2 toolchain: global.json names the sdk version and its roll
// policy; both ride the verdict path as toolchain dependencies.
export function parseGlobalJson(text: string): Result<DotnetToolchain> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	if (!isJsonRecord(parsed.value)) {
		return err(
			makeError(
				"CDX-E101",
				"global.json must hold a JSON object at its root",
				"Point the toolchain file at the sdk object.",
			),
		);
	}
	const sdk = recordField(parsed.value, "sdk");
	return ok({
		sdkVersion: sdk === undefined ? undefined : stringField(sdk, "version"),
		rollForward:
			sdk === undefined ? undefined : stringField(sdk, "rollForward"),
	});
}

// SPEC §6.2: the sdk version is exact like any other pin.
export function isExactDotnetSdk(version: string | undefined): boolean {
	return version !== undefined && NUGET_EXACT.test(version.trim());
}

// SPEC §6.2: only a disabled roll-forward keeps the toolchain exact; any
// other policy floats across sdk lines.
export function isPinnedRollForward(value: string | undefined): boolean {
	return value === "disable";
}
