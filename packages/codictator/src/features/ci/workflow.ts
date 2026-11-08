// SPEC §4.15.1: generated workflow rendering. Pure: action pins arrive via
// options (resolved at generation time by latest stable, §4.8.3); the CLI
// owns registry resolution and writes the file. Deterministic in its inputs,
// so regen is byte-identical across OSes (§4.14 EC-11).
import { sha256Text } from "../../kernel/index.ts";
import { liveCheck, liveIssue } from "./workflow-live.ts";

export interface CiWorkflow {
	readonly host: "github" | "external";
	readonly os: ReadonlyArray<string>;
	readonly steps: ReadonlyArray<string>;
	readonly text?: string;
	readonly scheduleCron?: string;
}

export interface WorkflowPins {
	readonly checkoutSha: string;
	readonly checkoutVersion: string;
	readonly setupNodeSha: string;
	readonly setupNodeVersion: string;
}

// SPEC §4.15.1: pins resolved at generation by latest stable (§4.8.3).
// Fallback used only when registry resolution is unavailable; generation
// prefers caller-supplied pins and records their versions in comments.
export const FALLBACK_PINS: WorkflowPins = {
	checkoutSha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
	checkoutVersion: "v7.0.1",
	setupNodeSha: "949feb2413d6458794dcd2491c4babbbce0c15c1",
	setupNodeVersion: "v7.1.0",
};

export interface RenderWorkflowOptions {
	readonly os?: ReadonlyArray<string>;
	readonly repoName?: string;
	readonly defaultBranch?: string;
	readonly pins?: WorkflowPins;
	readonly bot?: "auto" | "renovate" | "dependabot" | "none";
	// SPEC §4.15.5/§4.15.6: the self-host flag selects the source
	// bootstrap; consumer repos run the installed binary. Setup-detected
	// values arrive from init/regen detection; an omitted build or node
	// version file omits that step instead of hardcoding one.
	readonly selfHost?: boolean;
	readonly runCommand?: string;
	readonly installCommand?: string;
	readonly buildCommand?: string;
	readonly nodeVersionFile?: string;
}

// SPEC §4.15.1: daily schedule minute and hour derive from a hash of the
// repo name to spread load; hex parsing keeps this deterministic.
export function scheduleCronFor(repoName: string): string {
	const digest = sha256Text(repoName);
	const minute = Number.parseInt(digest.slice(0, 4), 16) % 60;
	const hour = Number.parseInt(digest.slice(4, 6), 16) % 24;
	return `${minute} ${hour} * * *`;
}

function sweepPermissions(bot: string): string {
	if (bot === "none") {
		return "    permissions:\n      contents: write\n      pull-requests: write\n";
	}
	// SPEC §4.15.1: a configured bot owns upgrades, so sweep stays read-only.
	return "    permissions:\n      contents: read\n";
}

// SPEC §4.15.5: this workflow also governs Codictator's own repo, where no
// published `codictator` binary exists on PATH yet — the self-host jobs
// therefore bootstrap the CLI from the local checkout (setup-node,
// install, build) and invoke the built entry, instead of assuming a
// published binary. Consumer repos run the installed binary resolved at
// install time (the plan-launcher.ts engine candidates), so the default
// render carries no source path, no build step and no version file until
// setup detection supplies them (§4.15.6 `npx --no-install codictator`).
const SELF_HOST_RUN = "node packages/codictator/dist/cli/main.js";
const CONSUMER_RUN = "npx --no-install codictator";

interface ResolvedSetup {
	readonly run: string;
	readonly install: string;
	readonly build: string | undefined;
	readonly nodeVersionFile: string | undefined;
}

// SPEC §4.15.1: the run, install, build and Node inputs resolve from the
// self-host flag plus setup-detected overrides, never from path guessing.
function resolveSetup(options?: RenderWorkflowOptions): ResolvedSetup {
	if (options?.selfHost === true) {
		return {
			run: options.runCommand ?? SELF_HOST_RUN,
			install: options.installCommand ?? "npm ci --ignore-scripts",
			build: options.buildCommand ?? "npm run build",
			nodeVersionFile: options.nodeVersionFile ?? ".nvmrc",
		};
	}
	return {
		run: options?.runCommand ?? CONSUMER_RUN,
		install: options?.installCommand ?? "npm ci --ignore-scripts",
		build: options?.buildCommand,
		nodeVersionFile: options?.nodeVersionFile,
	};
}

function setupNodeLines(
	pins: WorkflowPins,
	setup: ResolvedSetup,
): ReadonlyArray<string> {
	return [
		`      - uses: actions/setup-node@${pins.setupNodeSha} # ${pins.setupNodeVersion}`,
		"        with:",
		...(setup.nodeVersionFile === undefined
			? []
			: [`          node-version-file: ${setup.nodeVersionFile}`]),
		"          cache: npm",
	];
}

function installLines(setup: ResolvedSetup): ReadonlyArray<string> {
	return [
		`      - run: ${setup.install}`,
		...(setup.build === undefined ? [] : [`      - run: ${setup.build}`]),
	];
}

function recordBotChangeLines(run: string): ReadonlyArray<string> {
	// SPEC §4.15.3: the step passes the PR author and the changed files from
	// the Actions context, so the command's --author/--files contract holds;
	// forks ride along as --fork and are never written to. (Actions
	// expressions stay literal via \${{ escapes; only the runner path
	// interpolates.)
	return [
		"      - run: |",
		`          base_sha="\${{ github.event.pull_request.base.sha }}"`,
		`          record_args=(--author "\${{ github.event.pull_request.user.login }}")`,
		"          while IFS= read -r changed_file; do",
		'            if [ -n "$changed_file" ]; then record_args+=(--files="$changed_file"); fi',
		'          done < <(git diff --name-only "$base_sha"...HEAD --)',
		`          if [ "\${{ github.event.pull_request.head.repo.fork }}" = "true" ]; then record_args+=(--fork); fi`,
		`          ${run} ci record-bot-change "\${record_args[@]}"`,
	];
}

// SPEC §4.15.1: verify job block (EC-12). The full `codictator ci verify`
// gate runs on every event including pull_request (PRD §6 P6), so the
// required `verify (<os>)` matrix leg reports the gate verdict on the
// judged change, never SUCCESS through a no-op. (S27 core/function-size
// ratchet keeps this block extracted.)
function renderVerifyJob(
	matrix: string,
	pins: WorkflowPins,
	setup: ResolvedSetup,
): ReadonlyArray<string> {
	return [
		"  verify:",
		"    # No job-level skip: a skipped matrix job reports `verify` (SKIPPED),",
		"    # never the required `verify (<os>)` matrix-leg name, so the gate",
		"    # would block every PR. The full gate runs on every event (§4.15.1,",
		"    # EC-12, PRD §6 P6): push, pull_request, schedule and manual dispatch.",
		`    runs-on: \${{ matrix.os }}`,
		"    strategy:",
		"      matrix:",
		`        os: [${matrix}]`,
		"    steps:",
		...checkoutLines(pins, true),
		...setupNodeLines(pins, setup),
		...installLines(setup),
		`      - run: ${setup.run} ci verify`,
		"",
	];
}

function checkoutLines(
	pins: WorkflowPins,
	persistCredentials: boolean,
): ReadonlyArray<string> {
	return [
		`      - uses: actions/checkout@${pins.checkoutSha} # ${pins.checkoutVersion}`,
		"        with:",
		"          fetch-depth: 0",
		...(persistCredentials ? ["          persist-credentials: false"] : []),
	];
}

export function renderWorkflow(
	repoRoot: string,
	options?: RenderWorkflowOptions,
): CiWorkflow {
	const os = options?.os ?? ["ubuntu-latest"];
	const branch = options?.defaultBranch ?? "main";
	const pins = options?.pins ?? FALLBACK_PINS;
	const bot = options?.bot ?? "none";
	const setup = resolveSetup(options);
	const name = repoRoot.replaceAll("\\", "/").split("/").pop() ?? "repo";
	const cron = scheduleCronFor(options?.repoName ?? name);
	const matrix = os.map((runner) => `"${runner}"`).join(", ");
	const text = [
		"name: codictator",
		"",
		"# Generated by `codictator regen` (SPEC §4.15.1); do not edit by hand.",
		"on:",
		"  push:",
		`    branches: [${branch}]`,
		"  pull_request:",
		"  schedule:",
		`    - cron: "${cron}"`,
		"  workflow_dispatch:",
		"",
		"permissions:",
		"  contents: read",
		"",
		"concurrency:",
		`  group: codictator-\${{ github.ref }}`,
		`  cancel-in-progress: \${{ github.event_name == 'pull_request' }}`,
		"",
		"jobs:",
		...renderVerifyJob(matrix, pins, setup),
		"  record-bot-change:",
		"    if: github.event_name == 'pull_request'",
		"    permissions:",
		"      contents: write",
		"    runs-on: ubuntu-latest",
		"    steps:",
		...checkoutLines(pins, false),
		...setupNodeLines(pins, setup),
		...installLines(setup),
		...recordBotChangeLines(setup.run),
		"",
		"  sweep:",
		"    if: github.event_name == 'schedule'",
		sweepPermissions(bot).trimEnd(),
		"    runs-on: ubuntu-latest",
		"    steps:",
		...checkoutLines(pins, false),
		...setupNodeLines(pins, setup),
		...installLines(setup),
		`      - run: ${setup.run} ci sweep`,
		"",
		"  live:",
		"    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
		"    permissions:",
		"      contents: read",
		"      issues: write",
		"    runs-on: ubuntu-latest",
		"    steps:",
		...checkoutLines(pins, false),
		...setupNodeLines(pins, setup),
		...installLines(setup),
		...liveCheck,
		...liveIssue,
		"",
	].join("\n");
	return {
		host: "github",
		os,
		steps: [
			"checkout",
			"setup-node",
			"install",
			...(setup.build === undefined ? [] : ["build"]),
			"verify",
		],
		text,
		scheduleCron: cron,
	};
}
