// SPEC §4.8.6: the owned keys of the Dependabot config. Checks are
// pure over caller-supplied text; the enforcer layer reads the files.
import type { Finding } from "../engine/index.ts";

export interface DependabotUpdateEntry {
	readonly packageEcosystem: string;
	readonly directory: string;
	readonly scheduleInterval: string | undefined;
	readonly cooldownDays: string | undefined;
	readonly versioningStrategy: string | undefined;
}

interface UpdateScan {
	entries: Array<DependabotUpdateEntry>;
	current: {
		ecosystem?: string;
		directory?: string;
		interval?: string;
		cooldown?: string;
		strategy?: string;
	} | null;
	inSchedule: boolean;
	inCooldown: boolean;
	inAllow: boolean;
}

function flushScanEntry(scan: UpdateScan): void {
	if (scan.current !== null && scan.current.ecosystem !== undefined) {
		scan.entries.push({
			packageEcosystem: scan.current.ecosystem,
			directory: scan.current.directory ?? "/",
			scheduleInterval: scan.current.interval,
			cooldownDays: scan.current.cooldown,
			versioningStrategy: scan.current.strategy,
		});
	}
	scan.current = null;
	scan.inSchedule = false;
	scan.inCooldown = false;
	scan.inAllow = false;
}

function unquote(value: string): string {
	return value.replace(/^["']|["']$/g, "");
}

function scanUpdateKey(
	scan: UpdateScan,
	key: string | undefined,
	stripped: string,
): void {
	if (key === "schedule") {
		scan.inSchedule = true;
		scan.inCooldown = false;
		scan.inAllow = false;
		return;
	}
	if (key === "cooldown") {
		scan.inCooldown = true;
		scan.inSchedule = false;
		scan.inAllow = false;
		return;
	}
	if (key === "allow" || key === "ignore") {
		scan.inAllow = true;
		scan.inSchedule = false;
		scan.inCooldown = false;
		return;
	}
	if (key !== undefined && !stripped.startsWith("      ")) {
		scan.inSchedule = false;
		scan.inCooldown = false;
		scan.inAllow = false;
	}
}

function scanUpdateValue(
	scan: UpdateScan,
	key: string | undefined,
	value: string,
): void {
	if (scan.current === null || key === undefined) {
		return;
	}
	if (key === "directory" || key === "directories") {
		scan.current.directory = value;
	} else if (scan.inSchedule && key === "interval") {
		scan.current.interval = value;
	} else if (
		scan.inCooldown &&
		(key === "default-days" || key === "default_days")
	) {
		scan.current.cooldown = value;
	} else if (key === "versioning-strategy") {
		scan.current.strategy = value;
	}
}

function scanUpdateLine(scan: UpdateScan, line: string): void {
	const stripped = line.split("#")[0] ?? "";
	const trimmed = stripped.trim();
	if (trimmed === "") {
		return;
	}
	if (/^-\s+package-ecosystem\s*:/.test(trimmed)) {
		flushScanEntry(scan);
		scan.current = {
			ecosystem: unquote(trimmed.slice(trimmed.indexOf(":") + 1).trim()),
		};
		return;
	}
	if (scan.current === null) {
		return;
	}
	const key = /^\s{4,}([a-z-]+)\s*:/.exec(stripped)?.[1];
	scanUpdateKey(scan, key, stripped);
	if (scan.inAllow) {
		return;
	}
	const value = trimmed.includes(":")
		? unquote(trimmed.slice(trimmed.indexOf(":") + 1).trim())
		: "";
	scanUpdateValue(scan, key, value);
}

// Dependabot owned keys live under version updates entries; this reads only
// the owned subset with a line scan, never a general YAML parse.
export function parseDependabotUpdates(
	text: string,
): ReadonlyArray<DependabotUpdateEntry> {
	const scan: UpdateScan = {
		entries: [],
		current: null,
		inSchedule: false,
		inCooldown: false,
		inAllow: false,
	};
	for (const line of text.split("\n")) {
		scanUpdateLine(scan, line);
	}
	flushScanEntry(scan);
	return scan.entries;
}

function checkDependabotEntry(
	path: string,
	ecosystem: string,
	entry: DependabotUpdateEntry | undefined,
	minReleaseAgeDays: number,
): ReadonlyArray<Finding> {
	if (entry === undefined) {
		return [
			{
				ruleId: "core/dep-latest-stable",
				path,
				message: `${path} has no updates entry for ${ecosystem}`,
				remediation: `Regenerate the bot config with an entry for ${ecosystem}.`,
			},
		];
	}
	const findings: Array<Finding> = [];
	if (entry.scheduleInterval !== "daily") {
		findings.push({
			ruleId: "core/dep-latest-stable",
			path,
			message: `${path} schedules ${ecosystem} ${entry.scheduleInterval ?? "never"} instead of daily`,
			remediation: `Regenerate the bot config with a daily schedule.`,
		});
	}
	if (entry.cooldownDays !== String(minReleaseAgeDays)) {
		findings.push({
			ruleId: "core/dep-latest-stable",
			path,
			message: `${path} cools ${ecosystem} down ${entry.cooldownDays ?? "never"} instead of ${String(minReleaseAgeDays)} days`,
			remediation: `Regenerate the bot config with the owned cooldown.`,
		});
	}
	if (ecosystem === "npm" && entry.versioningStrategy !== "increase") {
		findings.push({
			ruleId: "core/dep-exact-pin",
			path,
			message: `${path} npm entry lacks versioning-strategy increase`,
			remediation: `Regenerate the bot config with the npm increase strategy.`,
		});
	}
	return findings;
}

// SPEC §4.8.6: one updates entry per detected ecosystem plus github-actions,
// daily schedule, cooldown of <n> days, npm increase strategy.
export function checkDependabotOwnedKeys(
	path: string,
	text: string,
	ecosystems: ReadonlyArray<string>,
	minReleaseAgeDays: number,
): ReadonlyArray<Finding> {
	const entries = parseDependabotUpdates(text);
	const findings: Array<Finding> = [];
	for (const ecosystem of [...ecosystems, "github-actions"]) {
		const entry = entries.find(
			(candidate) => candidate.packageEcosystem === ecosystem,
		);
		for (const finding of checkDependabotEntry(
			path,
			ecosystem,
			entry,
			minReleaseAgeDays,
		)) {
			findings.push(finding);
		}
	}
	return findings;
}
