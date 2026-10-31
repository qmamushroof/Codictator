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

// SPEC §6: dotnet pack manifest with its driver and extractors. The
// pack value here carries the identity the language-pack contract asserts
// while the enforcers that consume these supplies land; its pack.json
// lands with them, so `pack list` keeps failing closed until then.
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
