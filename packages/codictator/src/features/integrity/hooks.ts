// SPEC §4.14.4: git-hook installation. Content generation is pure so unit
// tests assert the scripts without touching .git/; the CLI wires ports.
export const EXPECTED_HOOKS_PATH = ".githooks";

export const HOOK_NAMES = ["pre-commit", "commit-msg", "pre-push"] as const;

export type HookName = (typeof HOOK_NAMES)[number];

// SPEC §4.14.4: each hook verifies node is on PATH and meets the minimum,
// else prints CDX-E001/CDX-E002 and exits 1; then execs the launcher.
export function renderHookScript(hook: HookName, minMajor = 24): string {
	const lines = [
		"#!/bin/sh",
		"# codictator:begin — managed by codictator; do not edit by hand.",
		"# SPEC §4.14.4: generated hook; repair with `codictator install-hooks`.",
		"if ! command -v node >/dev/null 2>&1; then",
		'  echo "CDX-E001: node is not on PATH; install Node.js to run Codictator hooks." >&2',
		"  exit 1",
		"fi",
		`if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= ${minMajor} ? 0 : 1)" >/dev/null 2>&1; then`,
		`  echo "CDX-E002: node is older than the required v${minMajor}; upgrade Node.js." >&2`,
		"  exit 1",
		"fi",
		'ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"',
		`exec node "$ROOT/.codictator/bin/run.mjs" git ${hook} "$@"`,
		"# codictator:end",
	];
	return `${lines.join("\n")}\n`;
}

export const HUSKY_BEGIN = "# codictator:begin";

export const HUSKY_END = "# codictator:end";

// SPEC §4.14.4: when .husky/ exists, Codictator inserts a managed block into
// Husky's hook files instead of taking over core.hooksPath.
export function renderHuskyBlock(hook: HookName): string {
	return (
		`${HUSKY_BEGIN} — managed by codictator; do not edit by hand.\n` +
		`.codictator/bin/run.mjs git ${hook} "$@"\n` +
		`${HUSKY_END}\n`
	);
}

export interface HookInstallPlan {
	readonly files: ReadonlyArray<string>;
	readonly mode: number;
	readonly hooksPath: string;
	readonly prepareScript: string;
	readonly gitattributes: string;
	readonly huskyBlocks: ReadonlyArray<string>;
}

// SPEC §4.14.4 + EC-9/EC-12: install-hooks writes the hooks (mode 755),
// points core.hooksPath at them, adds the npm prepare script, and records
// the gitattributes remediation for Windows commits without the exec bit.
export function hookInstallPlan(options?: {
	readonly huskyPresent?: boolean;
	readonly existingHooksPath?: string;
}): HookInstallPlan {
	const husky = options?.huskyPresent === true;
	const hooksPath = husky
		? (options?.existingHooksPath ?? ".husky")
		: EXPECTED_HOOKS_PATH;
	const files = husky
		? []
		: HOOK_NAMES.map((hook) => `${EXPECTED_HOOKS_PATH}/${hook}`);
	return {
		files,
		mode: 0o755,
		hooksPath,
		prepareScript: "codictator install-hooks",
		gitattributes: `${EXPECTED_HOOKS_PATH}/* linguist-generated=false\n${EXPECTED_HOOKS_PATH}/* eol=lf\n`,
		huskyBlocks: husky ? [...HOOK_NAMES] : [],
	};
}
