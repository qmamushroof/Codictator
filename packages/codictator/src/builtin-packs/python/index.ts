// SPEC §4.4.2 and §6: the python built-in pack (language rules plus
// ecosystem driver and extractors).
import type { Pack } from "../../kernel/index.ts";

export type {
	PyPiDependency,
	PyPiDepKind,
	PyPiPinForm,
	PyPiRequirement,
} from "../../features/deps/pypi.ts";
export {
	classifyPyPiSpec,
	isExactPyPiPin,
	isExactPythonVersion,
	PYPI_ECOSYSTEM,
	parsePythonVersionFile,
	parseRequirementsText,
	requirementsFullyPinned,
} from "../../features/deps/pypi.ts";
export type { PyProjectDeps } from "../../features/deps/pypi-pyproject.ts";
export { parsePyprojectDependencies } from "../../features/deps/pypi-pyproject.ts";

// SPEC §6: python pack manifest with its driver and extractors. The
// pack value here carries the identity the language-pack contract asserts
// while the enforcers that consume these supplies land; its pack.json
// lands with them, so `pack list` keeps failing closed until then.
export function pythonPack(): Pack {
	return {
		manifest: {
			id: "python",
			version: "0.0.0",
			description: "Codictator Python built-in pack (SPEC §6.3).",
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
