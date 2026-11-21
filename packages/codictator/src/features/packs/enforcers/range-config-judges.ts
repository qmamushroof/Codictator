// SPEC §4.15.1 L4 range judges over the repo state a range change touches:
// the test command, the baseline, the architecture profile, the waivers,
// the perf command and the generated workflow. Plus the rule-id table the
// code resolvers wrap with withRangeJudge.
import { checkArchProfile } from "../../arch/index.ts";
import { MAX_WAIVER_DAYS, readWaiverFile } from "../../engine/index.ts";
import { field, isRecord } from "../manifest.ts";
import { readSetup } from "./arch-live.ts";
import { COMMAND_WEAKENERS } from "./integrity-guards.ts";
import {
	baseText,
	flagRange,
	headJson,
	parseJsonText,
	type RangeArgs,
	type RangeJudge,
} from "./range-base.ts";
import {
	commentText,
	isPackTestFile,
	judgeAssertionLoss,
	judgeFixtureShrink,
	judgeGuardRemoval,
	judgeNewSuppressions,
} from "./range-test-judges.ts";

const CONFIG_FILE = ".codictator/config.json";

function stringAt(value: unknown, ...keys: ReadonlyArray<string>): unknown {
	let at = value;
	for (const key of keys) {
		at = isRecord(at) ? field(at, key) : undefined;
	}
	return at;
}

// SPEC §6.1 + §7.2: the npm test command is `scripts.test`, overridable by
// the `config.commands.test` argv array.
function testCommandOf(file: string, json: unknown): string {
	if (file === CONFIG_FILE) {
		const argv = stringAt(json, "commands", "test");
		return Array.isArray(argv) ? argv.join(" ") : "";
	}
	const script = stringAt(json, "scripts", "test");
	return typeof script === "string" ? script : "";
}

// SPEC §4.10.4 core/test-command-intact: the test command gains a weakener
// the base command did not carry.
async function judgeTestCommand(args: RangeArgs): Promise<void> {
	for (const file of args.files.filter(
		(name) => name === CONFIG_FILE || /(^|\/)package\.json$/.test(name),
	)) {
		const before = testCommandOf(
			file,
			parseJsonText((await baseText(args, file)) ?? ""),
		);
		const after = testCommandOf(file, await headJson(args, file));
		const added = COMMAND_WEAKENERS.find(
			(weakener) => after.includes(weakener) && !before.includes(weakener),
		);
		if (added !== undefined) {
			flagRange(args, file, `test command weakened in ${file}`, added);
		}
	}
}

const BASELINE_FILE = ".codictator/baseline.json";

// SPEC §7.6: `entries: { "<ruleId>@<measureVersion>": { "<metricKey>": n } }`.
function baselineCounts(json: unknown): Map<string, number> {
	const counts = new Map<string, number>();
	const entries = stringAt(json, "entries");
	for (const [rule, metrics] of Object.entries(
		isRecord(entries) ? entries : {},
	)) {
		for (const [key, count] of Object.entries(
			isRecord(metrics) ? metrics : {},
		)) {
			if (typeof count === "number") {
				counts.set(`${rule} ${key}`, count);
			}
		}
	}
	return counts;
}

// SPEC §4.3.5: a head baseline higher than the base baseline for any key
// blocks by core/no-baseline-raise.
async function judgeBaselineRaise(args: RangeArgs): Promise<void> {
	if (!args.files.includes(BASELINE_FILE)) {
		return;
	}
	const was = baselineCounts(
		parseJsonText((await baseText(args, BASELINE_FILE)) ?? ""),
	);
	for (const [key, count] of baselineCounts(
		await headJson(args, BASELINE_FILE),
	)) {
		const before = was.get(key) ?? 0;
		if (count > before) {
			flagRange(
				args,
				BASELINE_FILE,
				`baseline raised for ${key}`,
				`${String(before)} -> ${String(count)}`,
			);
		}
	}
}

// SPEC §4.11.4 core/arch-profile-declared: a changed config sets
// config.architecture.profile and every module kind is valid for it.
async function judgeArchProfile(args: RangeArgs): Promise<void> {
	if (!args.files.includes(CONFIG_FILE)) {
		return;
	}
	const profile = stringAt(
		await headJson(args, CONFIG_FILE),
		"architecture",
		"profile",
	);
	if (typeof profile !== "string") {
		flagRange(args, CONFIG_FILE, "architecture profile not declared");
		return;
	}
	const setup = await readSetup(args.ports);
	for (const found of checkArchProfile(profile, setup?.modules ?? [])) {
		flagRange(args, CONFIG_FILE, found.message);
	}
}

const DAY_MS = 86400000;

// SPEC §4.3.4: a waiver past its expiry, or spanning more than
// maxWaiverDays, blocks at L4 until the entry is removed.
async function judgeWaivers(args: RangeArgs): Promise<void> {
	const today = args.ctx.now.slice(0, 10);
	for (const waiver of await readWaiverFile(args.ports.fs)) {
		const span =
			(Date.parse(waiver.expires) - Date.parse(waiver.created)) / DAY_MS;
		if (waiver.expires < today || span > MAX_WAIVER_DAYS) {
			flagRange(
				args,
				".codictator/waivers.json",
				`waiver ${waiver.id} expired on ${waiver.expires} or exceeds ${String(MAX_WAIVER_DAYS)} days`,
				waiver.id,
			);
		}
	}
}

// SPEC §4.10.3 budget line.
const BUDGET_LINE = /codictator:budget\s+(p95|p99|rps|maxMs)\s*[<>]=?\s*\d+/;

// SPEC §4.15.2 core/perf-budgets: a changed test file whose comments
// declare a budget needs config.commands.perf.
async function judgePerfBudgets(args: RangeArgs): Promise<void> {
	const perf = stringAt(await headJson(args, CONFIG_FILE), "commands", "perf");
	if (Array.isArray(perf) && perf.length > 0) {
		return;
	}
	for (const file of args.files.filter(isPackTestFile)) {
		const text = await args.ports.fs.readText(file);
		if (text.ok && BUDGET_LINE.test(commentText(file, text.value))) {
			flagRange(args, file, `budget in ${file} with no config.commands.perf`);
			return;
		}
	}
}

const WORKFLOW_FILE = ".github/workflows/codictator.yml";

// SPEC §4.15.2 core/ci-present: the changed generated workflow keeps its
// `verify` job.
async function judgeWorkflow(args: RangeArgs): Promise<void> {
	if (!args.files.includes(WORKFLOW_FILE)) {
		return;
	}
	const text = await args.ports.fs.readText(WORKFLOW_FILE);
	if (text.ok && !/^ {2}verify:/m.test(text.value)) {
		flagRange(args, WORKFLOW_FILE, `no verify job in ${WORKFLOW_FILE}`);
	}
}

export const RANGE_JUDGES: Readonly<Record<string, RangeJudge>> = {
	"core/no-assertion-loss": judgeAssertionLoss,
	"core/no-new-suppressions": judgeNewSuppressions,
	"core/no-fixture-shrink": judgeFixtureShrink,
	"core/no-guard-removal": judgeGuardRemoval,
	"core/test-command-intact": judgeTestCommand,
	"core/no-baseline-raise": judgeBaselineRaise,
	"core/arch-profile-declared": judgeArchProfile,
	"core/waivers-valid": judgeWaivers,
	"core/perf-budgets": judgePerfBudgets,
	"core/ci-present": judgeWorkflow,
};
