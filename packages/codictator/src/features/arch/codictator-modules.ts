// SPEC §3.3: every module row as data. "dependsOn" mirrors the "may import"
// column; the composition root depends on everything and nothing imports it.
import type { ArchProfile } from "./arch-profiles.ts";
import type { ModuleNode } from "./index.ts";

export const CODICTATOR_PROFILE: ArchProfile = "app";

export const CODICTATOR_MODULES: ReadonlyArray<ModuleNode> = [
	{ name: "kernel", path: "src/kernel/**", kind: "kernel", dependsOn: [] },
	{
		name: "config",
		path: "src/features/config/**",
		kind: "feature",
		dependsOn: ["kernel"],
	},
	{
		name: "engine",
		path: "src/features/engine/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "audit"],
	},
	{
		name: "packs",
		path: "src/features/packs/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "adapters",
		path: "src/features/adapters/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "steering"],
	},
	{
		name: "steering",
		path: "src/features/steering/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "workflow"],
	},
	{
		name: "security",
		path: "src/features/security/**",
		kind: "feature",
		dependsOn: ["kernel", "engine"],
	},
	{
		name: "deps",
		path: "src/features/deps/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "records",
		path: "src/features/records/**",
		kind: "feature",
		dependsOn: ["kernel", "engine"],
	},
	{
		name: "testing",
		path: "src/features/testing/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "arch",
		path: "src/features/arch/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "workflow",
		path: "src/features/workflow/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "testing", "audit"],
	},
	{
		name: "remediation",
		path: "src/features/remediation/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine", "deps", "arch", "workflow"],
	},
	{
		name: "integrity",
		path: "src/features/integrity/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "ci",
		path: "src/features/ci/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "engine"],
	},
	{
		name: "generator",
		path: "src/features/generator/**",
		kind: "feature",
		dependsOn: ["kernel", "config", "packs", "llm"],
	},
	{
		name: "llm",
		path: "src/features/llm/**",
		kind: "feature",
		dependsOn: ["kernel"],
	},
	{
		name: "audit",
		path: "src/features/audit/**",
		kind: "feature",
		dependsOn: ["kernel"],
	},
	{
		name: "builtin-packs/core",
		path: "src/builtin-packs/core/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "builtin-packs/typescript",
		path: "src/builtin-packs/typescript/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "builtin-packs/dotnet",
		path: "src/builtin-packs/dotnet/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "builtin-packs/python",
		path: "src/builtin-packs/python/**",

		dependsOn: [
			"kernel",
			"engine",
			"security",
			"deps",
			"records",
			"testing",
			"arch",
			"workflow",
			"integrity",
			"steering",
			"ci",
		],
	},
	{
		name: "cli",
		path: "src/cli/**",
		kind: "composition",
		dependsOn: ["*"],
	},
];
