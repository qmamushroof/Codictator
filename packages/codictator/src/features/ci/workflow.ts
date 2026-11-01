// SPEC §4.15.1: generated workflow rendering. Pure: action pins arrive via
// options (resolved at generation time by latest stable, §4.8.3); the CLI
// owns registry resolution and writes the file. Deterministic in its inputs,
// so regen is byte-identical across OSes (§4.14 EC-11).
import { sha256Text } from "../../kernel/index.ts";

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

// SPEC §4.15.1: .github/workflows/codictator.yml, manifest-owned. Workflow
// default is contents: read; jobs raise only what they need.
// SPEC §4.15.5: this workflow also governs Codictator's own repo, where no
// published `codictator` binary exists on PATH yet — every job therefore
// bootstraps the CLI from the local checkout (setup-node, install, build)
// and invokes the built entry, instead of assuming a published binary.
// Build-from-source stays deterministic and keeps working post-publish.
const CODICTATOR_RUN = "node packages/codictator/dist/cli/main.js";

// SPEC §4.15.3: the step passes the PR author and the changed files from
// the Actions context, so the command's --author/--files contract holds;
// forks ride along as --fork and are never written to. (Actions
// expressions stay literal via \${{ escapes; only the runner path
// interpolates.)
const recordBotChange: ReadonlyArray<string> = [
	"      - run: |",
	`          base_sha="\${{ github.event.pull_request.base.sha }}"`,
	`          record_args=(--author "\${{ github.event.pull_request.user.login }}")`,
	"          while IFS= read -r changed_file; do",
	'            if [ -n "$changed_file" ]; then record_args+=(--files="$changed_file"); fi',
	'          done < <(git diff --name-only "$base_sha"...HEAD --)',
	`          if [ "\${{ github.event.pull_request.head.repo.fork }}" = "true" ]; then record_args+=(--fork); fi`,
	`          ${CODICTATOR_RUN} ci record-bot-change "\${record_args[@]}"`,
];

// SPEC §10.6: the scheduled live job checks real registry and OSV response
// shapes and harness-capture freshness, and opens an issue on drift. It is
// never a merge gate: the required-check read matches only the `verify`
// context (protection-read.ts strips matrix suffixes, then exact-matches),
// so `live` can never satisfy it, and the job runs only on schedule or
// manual dispatch — never on push or pull_request.
const liveCheck: ReadonlyArray<string> = [
  "      - name: live shape check (SPEC §10.6)",
  "        run: |",
  "          set -eu",
  "          curl -sSf --max-time 60 -o /tmp/live-packument.json https://registry.npmjs.org/typescript",
  `          curl -sSf --max-time 60 -H 'Content-Type: application/json' -d '{"package":{"name":"lodash","ecosystem":"npm"},"version":"4.17.20"}' -o /tmp/live-osv.json https://api.osv.dev/v1/query`,
  "          node <<'EOF'",
  "          const fs = require('fs');",
  "          function readJson(path) {",
  "            return JSON.parse(fs.readFileSync(path, 'utf8'));",
  "          }",
  "          const packument = readJson('/tmp/live-packument.json');",
  "          for (const key of ['name', 'versions', 'time', 'dist-tags']) {",
  "            if (!(key in packument)) {",
  "              throw new Error('registry shape drift: packument missing ' + key);",
  "            }",
  "          }",
  "          console.log('registry shape ok: ' + packument.name);",
  "          const osv = readJson('/tmp/live-osv.json');",
  "          if ('vulns' in osv && !Array.isArray(osv.vulns)) {",
  "            throw new Error('OSV shape drift: vulns is not a list');",
  "          }",
  "          console.log('OSV shape ok: ' + (osv.vulns || []).length + ' advisories');",
  "          const root = 'packages/codictator/fixtures/harness';",
  "          const stale = [];",
  "          function hasDirect(dir, name) {",
  "            return fs.readdirSync(dir).indexOf(name) >= 0;",
  "          }",
  "          function hasCapture(dir) {",
  "            return fs.readdirSync(dir).some(function (entry) {",
  "              return entry.endsWith('.json');",
  "            });",
  "          }",
  "          for (const harness of fs.readdirSync(root).sort()) {",
  "            const hdir = root + '/' + harness;",
  "            if (!fs.statSync(hdir).isDirectory()) {",
  "              continue;",
  "            }",
  "            for (const version of fs.readdirSync(hdir).sort()) {",
  "              const dir = hdir + '/' + version;",
  "              let stat = null;",
  "              try {",
  "                stat = fs.statSync(dir);",
  "              } catch (ignored) {",
  "                stat = null;",
  "              }",
  "              if (stat === null || !stat.isDirectory()) {",
  "                continue;",
  "              }",
  "              if (!hasDirect(dir, 'README.md') && !hasCapture(dir)) {",
  "                continue;",
  "              }",
  "              let readme = '';",
  "              try {",
  "                readme = fs.readFileSync(dir + '/README.md', 'utf8');",
  "              } catch (ignored) {",
  "                readme = '';",
  "              }",
  "              if (!/source:/i.test(readme) || !/version/i.test(readme)) {",
  "                stale.push(dir + ' (README missing source/version)');",
  "                continue;",
  "              }",
  "              for (const entry of fs.readdirSync(dir).sort()) {",
  "                if (!entry.endsWith('.json')) {",
  "                  continue;",
  "                }",
  "                let capture = null;",
  "                try {",
  "                  capture = JSON.parse(fs.readFileSync(dir + '/' + entry, 'utf8'));",
  "                } catch (ignored) {",
  "                  capture = null;",
  "                }",
  "                if (capture === null || typeof capture.provenance !== 'string' || capture.provenance === '') {",
  "                  stale.push(dir + '/' + entry + ' (no provenance)');",
  "                }",
  "              }",
  "            }",
  "          }",
  "          if (stale.length > 0) {",
  "            throw new Error('capture freshness drift: ' + stale.join(', '));",
  "          }",
  "          console.log('capture freshness ok');",
  "          EOF",
];

const liveIssue: ReadonlyArray<string> = [
  "      - name: open drift issue",
  "        if: failure()",
  "        env:",
  "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
  "        run: |",
  `          gh issue create --title "[live] scheduled drift detected" --body "The scheduled live job (SPEC §10.6) detected drift: a registry/OSV response shape changed or a harness capture lost its provenance. See the failing run: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}."`,
];

export function renderWorkflow(
	repoRoot: string,
	options?: RenderWorkflowOptions,
): CiWorkflow {
	const os = options?.os ?? ["ubuntu-latest"];
	const branch = options?.defaultBranch ?? "main";
	const pins = options?.pins ?? FALLBACK_PINS;
	const bot = options?.bot ?? "none";
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
		"  verify:",
		`    runs-on: \${{ matrix.os }}`,
		"    strategy:",
		"      matrix:",
		`        os: [${matrix}]`,
		"    steps:",
		`      - uses: actions/checkout@${pins.checkoutSha} # ${pins.checkoutVersion}`,
		"        with:",
		"          fetch-depth: 0",
		"          persist-credentials: false",
		`      - uses: actions/setup-node@${pins.setupNodeSha} # ${pins.setupNodeVersion}`,
		"        with:",
		"          node-version-file: .nvmrc",
		"          cache: npm",
		"      - run: npm ci --ignore-scripts",
		"      - run: npm run build",
		`      - run: ${CODICTATOR_RUN} ci verify`,
		"",
		"  record-bot-change:",
		"    if: github.event_name == 'pull_request'",
		"    permissions:",
		"      contents: write",
		"    runs-on: ubuntu-latest",
		"    steps:",
		`      - uses: actions/checkout@${pins.checkoutSha} # ${pins.checkoutVersion}`,
		"        with:",
		"          fetch-depth: 0",
		`      - uses: actions/setup-node@${pins.setupNodeSha} # ${pins.setupNodeVersion}`,
		"        with:",
		"          node-version-file: .nvmrc",
		"          cache: npm",
		"      - run: npm ci --ignore-scripts",
		"      - run: npm run build",
		...recordBotChange,
		"",
		"  sweep:",
		"    if: github.event_name == 'schedule'",
		sweepPermissions(bot).trimEnd(),
		"    runs-on: ubuntu-latest",
		"    steps:",
		`      - uses: actions/checkout@${pins.checkoutSha} # ${pins.checkoutVersion}`,
		"        with:",
		"          fetch-depth: 0",
		`      - uses: actions/setup-node@${pins.setupNodeSha} # ${pins.setupNodeVersion}`,
		"        with:",
		"          node-version-file: .nvmrc",
		"          cache: npm",
		"      - run: npm ci --ignore-scripts",
		"      - run: npm run build",
		`      - run: ${CODICTATOR_RUN} ci sweep`,
		"",
		"  live:",
		"    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
		"    permissions:",
		"      contents: read",
		"      issues: write",
		"    runs-on: ubuntu-latest",
		"    steps:",
		`      - uses: actions/checkout@${pins.checkoutSha} # ${pins.checkoutVersion}`,
		"        with:",
		"          fetch-depth: 0",
		`      - uses: actions/setup-node@${pins.setupNodeSha} # ${pins.setupNodeVersion}`,
		"        with:",
		"          node-version-file: .nvmrc",
		"          cache: npm",
		"      - run: npm ci --ignore-scripts",
		"      - run: npm run build",
		...liveCheck,
		...liveIssue,
		"",
	].join("\n");
	return {
		host: "github",
		os,
		steps: ["checkout", "setup-node", "install", "build", "verify"],
		text,
		scheduleCron: cron,
	};
}
