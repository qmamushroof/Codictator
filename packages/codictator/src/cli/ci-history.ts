// SPEC §4.9.3 + §4.15.1 + §4.9 EC-9: core/history-entry at L4 judges every
// non-merge commit in the range on its own files. The union-scope verdict
// cannot see that one entry covers several commits, so each commit must
// carry its own docs/HISTORY/ entry; the exemptions are the L3 commit-msg
// ones (merge commits, deps-shaped and manifest-owned sets).
import type { CommitInRange } from "../features/integrity/index.ts";
import type { Finding } from "../kernel/index.ts";
import { checkMissingHistoryEntry, runGitText } from "./git-history.ts";
import type { CommandPorts } from "./shared.ts";

async function commitFiles(
	ports: CommandPorts,
	sha: string,
): Promise<ReadonlyArray<string> | undefined> {
	const listed = await runGitText(ports, [
		"git",
		"diff-tree",
		"--no-commit-id",
		"--name-only",
		"-r",
		"--root",
		"-z",
		sha,
	]);
	if (!listed.ok) {
		return undefined;
	}
	return listed.value.split("\0").filter((path) => path !== "");
}

// An unreadable commit fails closed as a finding: skipping it would let a
// commit without an entry through, the defect this check fixes.
export async function rangeHistoryFindings(
	ports: CommandPorts,
	commits: ReadonlyArray<CommitInRange>,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const commit of commits) {
		if (commit.isMerge) {
			continue;
		}
		const sha = commit.sha;
		const short = sha.slice(0, 7);
		const files = await commitFiles(ports, sha);
		if (files === undefined) {
			findings.push({
				ruleId: "core/history-entry",
				message: `cannot read the files of commit ${short}, so its history entry is unverified`,
				remediation: "Re-run with a reachable --base <sha> --head <sha>.",
			});
			continue;
		}
		if (files.some((file) => file.startsWith("docs/HISTORY/"))) {
			continue;
		}
		for (const missing of checkMissingHistoryEntry(files)) {
			findings.push({
				...missing,
				message: `commit ${short} adds no history entry`,
			});
		}
	}
	return findings;
}
