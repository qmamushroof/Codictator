// The ordered L1 probe run of the Slice 0 firing guard: one consumer repo,
// every hook probe through the installed launcher, one hit per
// `<probe>::<rule>`. Shared by the umbrella firing test and the per-family
// acceptance tests, so the setup (task phase, plan, committed seeds) is
// written once.
import { strict as assert } from "node:assert";
import {
	denyReason,
	installConsumer,
	runLauncher,
	srcMain,
	taskId,
	toPlanning,
	writePayload,
	writeTreeFile,
} from "./consumer-harness.ts";
import { HOOK_CASES } from "./consumer-l1-cases.ts";
import { breakGuardrails } from "./consumer-l1-session.ts";
import { MATRIX } from "./consumer-matrix.ts";
import type { TempRepo } from "./temp-repo.ts";

export interface ProbeHit {
	readonly fired: boolean;
	readonly detail: string;
}

const HISTORY_SEED =
	"# History — 2026-11-08\n\n## 2026-11-08 · feat: seed\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** seed\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** none\n";
const BUGS_SEED =
	"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n| BUG-0000 | open | Seed row | 2026-11-08, none |  |  |\n";

// A consumer that accepted an architecture map (SPEC §4.11.2): two feature
// modules with no dependsOn edge, plus a committed beta file importing alpha
// so an alpha import of beta closes a cycle.
const ARCH_CONFIG = JSON.stringify({
	version: 1,
	codictator: "unknown",
	packs: [{ id: "typescript" }, { id: "python" }],
	harnesses: ["muse-code", "opencode"],
	architecture: {
		profile: "app",
		modules: [
			{ name: "alpha", path: "src/alpha/**", kind: "feature", dependsOn: [] },
			{ name: "beta", path: "src/beta/**", kind: "feature", dependsOn: [] },
		],
	},
});

export function rulesFor(probe: string): Array<string> {
	return MATRIX.filter(([, entry]) => entry === probe).map(([rule]) => rule);
}

export async function runL1Probes(
	repo: TempRepo,
): Promise<Map<string, ProbeHit>> {
	const hits = new Map<string, ProbeHit>();
	await installConsumer(repo);
	const hookProbe = async (probe: string): Promise<void> => {
		const payload = HOOK_CASES[probe]?.(repo.dir);
		assert.ok(payload !== undefined, `no payload for ${probe}`);
		const result = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(payload),
		);
		const reason = denyReason(result.stdout);
		for (const rule of rulesFor(probe)) {
			hits.set(`${probe}::${rule}`, {
				fired: reason?.includes(rule) ?? false,
				detail: (reason ?? result.stdout).slice(0, 200),
			});
		}
	};
	await hookProbe("write-notask");
	const id = await taskId(repo, "matrix widget");
	await toPlanning(repo, id);
	const control = await runLauncher(
		repo.dir,
		["hook", "muse-code", "PreToolUse"],
		JSON.stringify(
			writePayload(repo.dir, "tests/mx.test.ts", 'test("mx", () => {});\n'),
		),
	);
	assert.equal(
		denyReason(control.stdout),
		undefined,
		`probe harness broken: ${control.stdout}`,
	);
	writeTreeFile(repo, "src/mx-readable.ts", "export const r = 1;\n");
	for (const probe of [
		"write-preproof",
		"write-secret",
		"write-outside",
		"shell-danger",
		"read-secret",
		"read-twice",
		"read-twice",
		"glob-broad",
		"write-ts-phantom",
		"write-ts-eval",
		"write-py-phantom",
		"write-py-eval",
		"write-badname",
		"shell-bypass",
	]) {
		await hookProbe(probe);
	}
	writeTreeFile(repo, ".codictator/config.json", ARCH_CONFIG);
	writeTreeFile(repo, "src/beta/index.ts", 'import "../alpha/index";\n');
	writeTreeFile(repo, "src/alpha/index.ts", "export const a = 1;\n");
	for (const probe of [
		"write-arch-unmapped",
		"write-arch-boundary",
		"write-arch-deep",
		"write-arch-cycle",
	]) {
		await hookProbe(probe);
	}
	repo.writeFile("docs/HISTORY/2026-11-08.md", HISTORY_SEED);
	repo.git(["commit", "--no-verify", "-m", "seed history"]);
	await hookProbe("write-history-edit");
	repo.writeFile("docs/BUGS/2026.md", BUGS_SEED);
	repo.git(["commit", "--no-verify", "-m", "seed bugs"]);
	await hookProbe("write-bugs-edit");
	await hookProbe("write-package");
	await hookProbe("write-workflow");
	const narrowed = await srcMain(
		["task", "amend", "--id", id, "--set-allow", "tests/**"],
		repo.dir,
	);
	assert.equal(narrowed.code, 0, `narrow failed: ${narrowed.stderr}`);
	await hookProbe("write-narrow");
	repo.git(["checkout", "-b", "fix-probe"]);
	const fixOut = await srcMain(
		["task", "new", "--type", "fix", "--title", "mx"],
		repo.dir,
	);
	assert.equal(fixOut.code, 0, `fix task failed: ${fixOut.stderr}`);
	await hookProbe("write-fix-nodiag");
	await breakGuardrails(repo);
	const session = await runLauncher(
		repo.dir,
		["hook", "muse-code", "SessionStart"],
		JSON.stringify({ session_id: "sess-consumer-0", cwd: repo.dir }),
	);
	for (const rule of rulesFor("session")) {
		hits.set(`session::${rule}`, {
			fired: session.stdout.includes(rule),
			detail: session.stdout.slice(0, 200),
		});
	}
	return hits;
}

// One line per MATRIX row the filter selects whose probe did not name its
// rule, in MATRIX order.
export function silentRules(
	hits: ReadonlyMap<string, ProbeHit>,
	selected: (rule: string, probe: string) => boolean,
): Array<string> {
	const misses: Array<string> = [];
	for (const [rule, probe, gap] of MATRIX) {
		if (!selected(rule, probe)) {
			continue;
		}
		const hit = hits.get(`${probe}::${rule}`);
		if (hit === undefined) {
			misses.push(`${rule} (${probe}): no probe result recorded`);
		} else if (!hit.fired) {
			misses.push(`${rule} (${probe}, ${gap}) silent: ${hit.detail}`);
		}
	}
	return misses;
}
