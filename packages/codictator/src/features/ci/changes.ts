// SPEC §4.15.3 (bot dependency changes), §4.15.4 (scheduled sweep) and
// §4.15.6 (external CI). Pure over caller-supplied change data; writing the
// history commit is the CLI's job through kernel ports.
import type { Finding } from "../engine/index.ts";

const RECOGNISED_BOTS = ["renovate[bot]", "dependabot[bot]"];

const MANIFEST_BASENAMES = new Set([
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lockb",
	"Gemfile.lock",
	"poetry.lock",
	"requirements.txt",
	"renovate.json",
	"renovate.json5",
	".renovaterc",
	".renovaterc.json",
	"dependabot.yml",
	".nvmrc",
]);

export interface BotChangeInput {
	readonly author: string;
	readonly filesChanged: ReadonlyArray<string>;
	readonly isFork: boolean;
	readonly trailerExempt: ReadonlyArray<string>;
}

export interface BotChangePlan {
	readonly qualifies: boolean;
	readonly writeCommit: boolean;
	readonly findings: Array<Finding>;
}

export function isRecognisedBot(
	author: string,
	trailerExempt: ReadonlyArray<string>,
): boolean {
	return RECOGNISED_BOTS.includes(author) || trailerExempt.includes(author);
}

function touchesOnlyManifests(files: ReadonlyArray<string>): boolean {
	if (files.length === 0) {
		return false;
	}
	return files.every((file) => {
		const base = file.replaceAll("\\", "/").split("/").pop() ?? file;
		return MANIFEST_BASENAMES.has(base) || base.endsWith(".lock");
	});
}

// SPEC §4.15.3: a PR qualifies when its commits only touch manifests and
// lockfiles and its author is a recognised bot. Fork PRs are never written
// to; their entries are required as usual (EC-8).
export function qualifyBotChange(input: BotChangeInput): BotChangePlan {
	if (!isRecognisedBot(input.author, input.trailerExempt)) {
		return { qualifies: false, writeCommit: false, findings: [] };
	}
	if (!touchesOnlyManifests(input.filesChanged)) {
		return {
			qualifies: false,
			writeCommit: false,
			findings: [
				{
					ruleId: "core/history-entry",
					message: `bot PR by ${input.author} touches non-manifest files: the history entry is required`,
					remediation:
						"Record the change in docs/HISTORY like any other change (§4.15.3).",
				},
			],
		};
	}
	if (input.isFork) {
		return {
			qualifies: true,
			writeCommit: false,
			findings: [
				{
					ruleId: "core/history-entry",
					message:
						"bot PR from a fork: no commit written; the history entry is required",
					remediation:
						"Carry the deps entry in the PR body or a follow-up commit (EC-8).",
				},
			],
		};
	}
	return { qualifies: true, writeCommit: true, findings: [] };
}

export interface SweepInput {
	readonly sweepPrOpen: boolean;
	// SPEC §4.15.4: fresh floor findings on the default branch; a sweep that
	// finds any fails, making the escape visible (EC-10).
	readonly floorFindings: ReadonlyArray<Finding>;
}

export interface SweepPlan {
	readonly pr: string;
	readonly action: "update-in-place" | "create";
	readonly findings: Array<Finding>;
}

// SPEC §4.15.4: changes to committed state go to a single codictator/sweep
// PR updated in place, never to the default branch (EC-9). A sweep that
// finds a new floor finding on the default branch fails (EC-10).
export function planSweep(input: SweepInput): SweepPlan {
	return {
		pr: "codictator/sweep",
		action: input.sweepPrOpen ? "update-in-place" : "create",
		findings: [...input.floorFindings],
	};
}

// SPEC §4.15.6: host external skips workflow generation; without the human
// confirmation record the gate stays unverified everywhere.
export function externalCiStatus(options: {
	readonly host: "github" | "external";
	readonly confirmed: boolean;
}): Array<Finding> {
	if (options.host === "github" || options.confirmed) {
		return [];
	}
	return [
		{
			ruleId: "core/ci-present",
			message:
				"external CI host without a confirmation record: the gate is unverified",
			remediation:
				"Wire `npx --no-install codictator ci verify --base <sha> --head <sha>` as a required check and confirm it (§4.15.6).",
		},
	];
}
