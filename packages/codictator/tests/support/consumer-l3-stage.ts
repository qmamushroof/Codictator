// The L3 stage probes of the Slice 0 firing guard: one consumer repo, each
// probe stages a file set and runs the installed launcher's pre-commit, then
// a bad commit message goes through commit-msg. One hit per
// `<probe>::<rule>`. Shared by the umbrella firing test and the per-family
// acceptance test, so the probe payloads are written once.

import {
	runLauncher,
	taskId,
	toPlanning,
	writeTreeFile,
} from "./consumer-harness.ts";
import type { ProbeHit } from "./consumer-l1-run.ts";
import type { TempRepo } from "./temp-repo.ts";

const SHARED =
	"The shared consumer sentence carries more than twelve words so the owner check sees it twice.";

interface StageProbe {
	readonly probe: string;
	readonly writes: ReadonlyArray<readonly [string, string]>;
	// Files the probe needs on disk but never stages (the registry cache is
	// git-ignored in a consumer, SPEC §4.8.4).
	readonly seeds?: ReadonlyArray<readonly [string, string]>;
	readonly rules: ReadonlyArray<string>;
}

// SPEC §4.8.4 + §7.12: a test repo supplies its registry snapshot in its
// tree; the pinned left-pad version carries an advisory and a deprecation.
const SNAPSHOT = JSON.stringify({
	version: 1,
	ecosystem: "npm",
	fetchedAt: "2026-11-21T00:00:00.000Z",
	packages: { "left-pad": { versions: { "1.3.0": { deprecated: true } } } },
	advisories: { "left-pad@1.3.0": ["GHSA-consumer-0001"] },
});

export const STAGE_PROBES: ReadonlyArray<StageProbe> = [
	{
		probe: "stage-planning",
		// SPEC §5.11: dist/ is committed build output.
		writes: [
			["src/g.ts", "export const g = 1;\n"],
			["dist/g.js", "export const g = 1;\n"],
		],
		rules: ["core/repo-hygiene"],
	},
	{
		probe: "stage-docs",
		writes: [
			[
				"docs/guide.md",
				// "contains" matches the SPEC 04-09 corpus-count regex on purpose.
				`# Guide\n\nSee [missing](./missing.md).\n\nUpdated on 2026-01-01: added things.\n\nThe docs contains 5 guides.\n\n${SHARED}\n`,
			],
			["docs/other.md", `# Other\n\n${SHARED}\n`],
			["docs/SPEC/sub/deep.md", "# Deep\n"],
			// SPEC §4.9.5 EC-1: a router that holds a paragraph.
			["docs/PLAN.md", "# Plan\n\nA router must not hold prose.\n"],
			["docs/PLAN/01-A.md", "# A\n"],
		],
		rules: [
			"core/doc-one-level",
			"core/doc-router-leaf",
			"core/doc-links-valid",
			"core/doc-no-inline-changelog",
			"core/doc-no-corpus-counts",
			"core/doc-single-owner",
		],
	},
	{
		probe: "stage-deps",
		writes: [
			[
				"package.json",
				'{"name":"mx","version":"0.0.0","dependencies":{"left-pad":"1.3.0"}}\n',
			],
		],
		seeds: [[".codictator/cache/registry/npm.json", SNAPSHOT]],
		rules: [
			"core/dep-no-vulnerable",
			"core/dep-no-deprecated",
			"core/dep-new-needs-reason",
			"core/dep-lockfile",
		],
	},
	{
		probe: "stage-history",
		writes: [
			[
				"docs/HISTORY/2026-11-08.md",
				"# History — 2026-11-08\n\n## 2026-11-08 · feat: thing\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n",
			],
		],
		rules: ["core/history-entry-complete"],
	},
];

export async function runStageProbes(
	repo: TempRepo,
	hits: Map<string, ProbeHit>,
): Promise<void> {
	const gid = await taskId(repo, "matrix git");
	await toPlanning(repo, gid);
	for (const entry of STAGE_PROBES) {
		for (const [file, content] of [...entry.writes, ...(entry.seeds ?? [])]) {
			writeTreeFile(repo, file, content);
		}
		repo.git(["reset"]);
		repo.git(["add", ...entry.writes.map(([file]) => file)]);
		const result = await runLauncher(repo.dir, ["git", "pre-commit"]);
		const text = `${result.stdout}${result.stderr}`;
		for (const rule of entry.rules) {
			hits.set(`${entry.probe}::${rule}`, {
				fired: result.code !== 0 && text.includes(rule),
				detail: text.slice(0, 300),
			});
		}
	}
	writeTreeFile(repo, "src/msg.ts", "export const m = 1;\n");
	writeTreeFile(
		repo,
		"docs/HISTORY/2026-11-08.md",
		"# History — 2026-11-08\n\n## 2026-11-08 · feat: complete\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** none\n",
	);
	repo.git(["reset"]);
	repo.git(["add", "src/msg.ts", "docs/HISTORY/2026-11-08.md"]);
	writeTreeFile(repo, "COMMIT_MSG", "wip stuff\n");
	const msgBad = await runLauncher(repo.dir, [
		"git",
		"commit-msg",
		`${repo.dir}/COMMIT_MSG`,
	]);
	hits.set("msg-badsubject::core/conventional-commit", {
		fired:
			msgBad.code !== 0 && msgBad.stdout.includes("core/conventional-commit"),
		detail: `${msgBad.stdout}${msgBad.stderr}`.slice(0, 300),
	});
}
