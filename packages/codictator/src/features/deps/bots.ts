// SPEC §4.8.6: upgrade-bot detection. Detection is pure over the file list;
// owned-key checks live in bot-config.ts over caller-supplied text, so no
// port is needed until the enforcer layer reads the files.
export type UpgradeBot = "renovate" | "dependabot" | "codictator";

const RENOVATE_FILES = [
	"renovate.json",
	"renovate.json5",
	".github/renovate.json",
	".github/renovate.json5",
	".renovaterc",
	".renovaterc.json",
	".renovaterc.json5",
];

const DEPENDABOT_FILE = ".github/dependabot.yml";

// SPEC §4.8.6: renovate files → Renovate; dependabot.yml → Dependabot;
// neither → Codictator upgrades (§4.8.7).
export function detectUpgradeBots(files: ReadonlyArray<string>): UpgradeBot {
	const names = new Set(files.map((file) => file.replaceAll("\\", "/")));
	const hasRenovate = RENOVATE_FILES.some((candidate) => names.has(candidate));
	const hasDependabot = names.has(DEPENDABOT_FILE);
	if (hasRenovate && hasDependabot) {
		return "renovate";
	}
	if (hasRenovate) {
		return "renovate";
	}
	if (hasDependabot) {
		return "dependabot";
	}
	return "codictator";
}

export function isRenovateFile(path: string): boolean {
	return RENOVATE_FILES.includes(path.replaceAll("\\", "/"));
}

export function isDependabotFile(path: string): boolean {
	return path.replaceAll("\\", "/") === DEPENDABOT_FILE;
}

// SPEC §4.8.7: one branch per dependency grouping patch and minor of the same
// package line; majors become remediation chains (§4.13.5), never single PRs.
export function upgradeBranchName(
	ecosystem: string,
	name: string,
	version: string,
): string {
	const safe = `${name}-${version}`.replaceAll(/[^0-9A-Za-z._-]+/g, "-");
	return `codictator/deps/${ecosystem}/${safe}`;
}
