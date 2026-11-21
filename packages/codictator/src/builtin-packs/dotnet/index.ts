// SPEC §4.4.2 and §6: the dotnet built-in pack (language rules plus
// ecosystem driver and extractors).
import type { Pack } from "../../kernel/index.ts";

export type {
	CsprojPackageRef,
	DotnetToolchain,
	NuGetDependency,
	NuGetDepKind,
	NuGetPinForm,
} from "../../features/deps/nuget.ts";
export {
	classifyNuGetRange,
	csprojInlineVersions,
	isExactDotnetSdk,
	isExactNuGetPin,
	isPinnedRollForward,
	NUGET_ECOSYSTEM,
	parseCsprojPackageRefs,
	parseDirectoryPackagesProps,
	parseGlobalJson,
} from "../../features/deps/nuget.ts";

// SPEC §6: dotnet pack manifest with its driver and extractors. pack.json
// (SPEC §4.4.2) carries the §6.2 capabilities and no rules yet: the
// dotnet/build, dotnet/format and dotnet/no-phantom-reference enforcers land
// later, and a rule with a deferred enforcer would fail closed (CDX-E901) on
// every dotnet repo. The pack value here carries the identity the
// language-pack contract asserts.
export function dotnetPack(): Pack {
	return {
		manifest: {
			id: "dotnet",
			version: "0.0.0",
			description: "Codictator .NET built-in pack (SPEC §6.2).",
			rules: [],
			enforcers: [],
			drivers: [],
			extractors: [],
			measures: [],
			capabilities: [],
			assets: [],
			maxWaiverDays: 90,
		},
		enforcers: [],
		drivers: [],
		assets: [],
	};
}
