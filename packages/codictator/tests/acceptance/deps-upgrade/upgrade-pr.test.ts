// SPEC §4.8.7: `deps upgrade --pr` opens one branch and one PR per
// dependency against the git host. The host is a bare repo standing in for
// the forge; every git op is real and deterministic (fixed author dates), so
// this acceptance test proves the branch, the pin bump and the history entry
// land on the host exactly as planned.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	planUpgradePr,
	runUpgradePr,
	type UpgradeFile,
	type UpgradeHost,
	upgradeBranchName,
} from "../../../src/features/deps/index.ts";
import {
	checkHistoryEntryComplete,
	parseHistoryEntries,
} from "../../../src/features/records/index.ts";
import type { Result } from "../../../src/kernel/index.ts";
import { makeError } from "../../../src/kernel/index.ts";
import {
	createBareRepo,
	createTempRepo,
	type TempRepo,
} from "../../support/temp-repo.ts";

function hostFrom(repo: TempRepo): UpgradeHost {
	const run = (args: ReadonlyArray<string>): Result<void> => {
		try {
			repo.git(args);
			return { ok: true, value: undefined };
		} catch {
			return {
				ok: false,
				error: makeError(
					"CDX-E703",
					"fake host git op failed",
					"Inspect the acceptance test git fixture.",
				),
			};
		}
	};
	return {
		createBranch: (branch: string) =>
			Promise.resolve(run(["checkout", "-b", branch])),
		writeFiles: (files: ReadonlyArray<UpgradeFile>) =>
			Promise.resolve(
				((): Result<void> => {
					for (const file of files) {
						repo.writeFile(file.path, file.text);
					}
					return { ok: true, value: undefined };
				})(),
			),
		commit: (message: string) =>
			Promise.resolve(
				((): Result<void> => {
					try {
						repo.commit(message);
						return { ok: true, value: undefined };
					} catch {
						return {
							ok: false,
							error: makeError(
								"CDX-E703",
								"fake host git commit failed",
								"Inspect the acceptance test git fixture.",
							),
						};
					}
				})(),
			),
		push: (branch: string) => Promise.resolve(run(["push", "host", branch])),
	};
}

test("[§4.8.7] upgrade --pr pushes pin bump and history entry to the fake host", async () => {
	const manifestText = [
		"{",
		'  "name": "brownfield",',
		'  "version": "1.0.0",',
		'  "dependencies": {',
		'    "lodash": "4.17.20"',
		"  }",
		"}",
	].join("\n");
	const repo = createTempRepo({
		"package.json": manifestText,
		"docs/HISTORY/2026-01.md": "# History — 2026-01\n",
	});
	const host = createBareRepo();
	try {
		repo.git(["remote", "add", "host", host.dir]);
		const planned = planUpgradePr({
			ecosystem: "npm",
			name: "lodash",
			from: "4.17.20",
			to: "4.17.21",
			manifestPath: "package.json",
			manifestText,
			historyText: "# History — 2026-01\n",
			date: "2026-01-01",
			lockfilePath: "package-lock.json",
			lockfileText: '{"lockfileVersion": 3, "packages": {}}',
		});
		assert.equal(planned.ok, true);
		if (!planned.ok) {
			return;
		}
		assert.equal(planned.value.branch, "codictator/deps/npm/lodash-4.17.21");
		assert.equal(
			planned.value.branch,
			upgradeBranchName("npm", "lodash", "4.17.21"),
		);
		const applied = await runUpgradePr(planned.value, hostFrom(repo));
		assert.equal(applied.ok, true);

		const branch = planned.value.branch;
		const listed: string = execFileSync(
			"git",
			["--git-dir", host.dir, "ls-remote", "--heads", host.dir, branch],
			{ encoding: "utf8" },
		);
		assert.match(listed, /refs\/heads\//);
		const pushedManifest: string = execFileSync(
			"git",
			["--git-dir", host.dir, "show", `${branch}:package.json`],
			{ encoding: "utf8" },
		);
		assert.ok(pushedManifest.includes('"lodash": "4.17.21"'));
		const pushedHistory: string = execFileSync(
			"git",
			["--git-dir", host.dir, "show", `${branch}:docs/HISTORY/2026-01.md`],
			{ encoding: "utf8" },
		);
		assert.ok(pushedHistory.includes("↑ lodash 4.17.20 → 4.17.21 — none"));
		const pushedSubject: string = execFileSync(
			"git",
			["--git-dir", host.dir, "log", "--format=%s", "-n", "1", branch],
			{ encoding: "utf8" },
		).trim();
		assert.equal(pushedSubject, planned.value.subject);

		const parsed = parseHistoryEntries(pushedHistory);
		assert.equal(parsed.entries.length, 1);
		assert.equal(parsed.entries[0]?.subject, planned.value.subject);
		const entry = parsed.entries[0];
		assert.ok(entry !== undefined);
		if (entry !== undefined) {
			assert.deepEqual(
				checkHistoryEntryComplete(entry, "docs/HISTORY/2026-01.md"),
				[],
			);
		}
		const worktreeHistory = readFileSync(
			path.join(repo.dir, "docs", "HISTORY", "2026-01.md"),
			"utf8",
		);
		assert.equal(worktreeHistory, pushedHistory);
	} finally {
		repo.cleanup();
		host.cleanup();
	}
});
