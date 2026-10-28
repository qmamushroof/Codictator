// SPEC §4.8.6: the owned keys of the Renovate config. Checks are
// pure over caller-supplied text; the enforcer layer reads the files.
import { parseJson } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import { field, isJsonRecord, recordField } from "./fields.ts";

export interface RenovateOwnedKeys {
	readonly rangeStrategy: string;
	readonly minimumReleaseAge: string | null;
	readonly osvVulnerabilityAlerts: boolean;
	readonly pinDigests: boolean;
	readonly separateMajorMinor: boolean;
	readonly lockFileMaintenanceEnabled: boolean;
	readonly dependencyDashboard: boolean;
	readonly extendsHasActionDigests: boolean;
}

// SPEC §4.8.6: Renovate owned keys with values from the effective config.
export function expectedRenovateKeys(
	minReleaseAgeDays: number,
): RenovateOwnedKeys {
	return {
		rangeStrategy: "pin",
		minimumReleaseAge: `${String(minReleaseAgeDays)} days`,
		osvVulnerabilityAlerts: true,
		pinDigests: true,
		separateMajorMinor: true,
		lockFileMaintenanceEnabled: true,
		dependencyDashboard: true,
		extendsHasActionDigests: true,
	};
}

// JSON5 tolerance for renovate.json5: strip line/block comments and trailing
// commas before the kernel JSON parse. Anything else stays a parse error.
export function parseRenovateText(text: string): ReturnType<typeof parseJson> {
	const stripped = text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/[^\n]*/g, "$1")
		.replace(/,(\s*[}\]])/g, "$1");
	return parseJson(stripped);
}

function checkRenovateRange(
	path: string,
	config: Record<string, unknown>,
	expected: RenovateOwnedKeys,
): Finding | undefined {
	if (field(config, "rangeStrategy") === expected.rangeStrategy) {
		return undefined;
	}
	return {
		ruleId: "core/dep-exact-pin",
		path,
		message: `${path} sets rangeStrategy to ${JSON.stringify(field(config, "rangeStrategy"))} instead of "pin"`,
		remediation: `Regenerate the bot config so rangeStrategy is "pin".`,
	};
}

function checkRenovateExtends(
	path: string,
	config: Record<string, unknown>,
): Finding | undefined {
	const extendsValue = field(config, "extends");
	const extendsList = Array.isArray(extendsValue)
		? extendsValue.filter((entry): entry is string => typeof entry === "string")
		: [];
	if (
		extendsList.some((entry) =>
			entry.includes("helpers:pinGitHubActionDigests"),
		)
	) {
		return undefined;
	}
	return {
		ruleId: "core/dep-exact-pin",
		path,
		message: `${path} extends misses helpers:pinGitHubActionDigests`,
		remediation: `Regenerate the bot config with the owned extends entry.`,
	};
}

function checkRenovateOsv(
	path: string,
	config: Record<string, unknown>,
): Finding | undefined {
	if (field(config, "osvVulnerabilityAlerts") === true) {
		return undefined;
	}
	return {
		ruleId: "core/dep-no-vulnerable",
		path,
		message: `${path} disables osvVulnerabilityAlerts`,
		remediation: `Regenerate the bot config with osvVulnerabilityAlerts enabled.`,
	};
}

function checkRenovateS9(
	path: string,
	config: Record<string, unknown>,
): Finding | undefined {
	const vulnAlerts = recordField(config, "vulnerabilityAlerts");
	if (
		vulnAlerts !== undefined &&
		field(vulnAlerts, "minimumReleaseAge") === null
	) {
		return undefined;
	}
	return {
		ruleId: "core/dep-no-vulnerable",
		path,
		message: `${path} lacks the S9 vulnerabilityAlerts.minimumReleaseAge null exemption`,
		remediation: `Regenerate the bot config with the S9 exemption.`,
	};
}

// SPEC §4.8.8 EC-15: an owned key with the wrong value is drift until regen
// rewrites it; each drift is a finding on the bot file.
export function checkRenovateOwnedKeys(
	path: string,
	text: string,
	minReleaseAgeDays: number,
): ReadonlyArray<Finding> {
	const parsed = parseRenovateText(text);
	if (!parsed.ok || !isJsonRecord(parsed.value)) {
		return [];
	}
	const config = parsed.value;
	const expected = expectedRenovateKeys(minReleaseAgeDays);
	const findings: Array<Finding> = [];
	for (const check of [
		checkRenovateRange(path, config, expected),
		checkRenovateExtends(path, config),
		checkRenovateOsv(path, config),
		checkRenovateS9(path, config),
	]) {
		if (check !== undefined) {
			findings.push(check);
		}
	}
	return findings;
}
