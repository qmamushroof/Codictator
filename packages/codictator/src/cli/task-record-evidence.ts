// SPEC §4.12.2 row 6: the record exit gate observes its own evidence. A
// staged docs/HISTORY entry is the history evidence; for a fix, the staged
// entry's `Bug:` row reads fixed or wontfix in the index and read open at
// the merge base of HEAD with the default branch (§4.9.4). Git runs through
// the CLI's process port, like the other hook-scope readers.
import type { TaskRecord } from "../features/workflow/index.ts";
import { runGitText } from "./git-history.ts";
import type { CommandPorts } from "./shared.ts";

export interface RecordEvidence {
	readonly historyStaged: boolean;
	readonly bugRowUpdated: boolean;
}

const BUG_LINE = /^\+- \*\*Bug:\*\* (BUG-\d{4})\s*$/;

function lines(text: string): Array<string> {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

// Status cell of a registry row: `| BUG-#### | <status> | ...`.
function statusOf(grepLines: string, bug: string): string | undefined {
	for (const line of lines(grepLines)) {
		const at = line.indexOf(`| ${bug} |`);
		if (at >= 0) {
			return line.slice(at).split("|")[2]?.trim();
		}
	}
	return undefined;
}

async function rowStatus(
	ports: CommandPorts,
	bug: string,
	rev: string | undefined,
): Promise<string | undefined> {
	const needle = `| ${bug} |`;
	const argv =
		rev === undefined
			? ["git", "grep", "--cached", "-h", "-F", needle, "--", "docs/BUGS"]
			: ["git", "grep", "-h", "-F", needle, rev, "--", "docs/BUGS"];
	const ran = await runGitText(ports, argv);
	return ran.ok ? statusOf(ran.value, bug) : undefined;
}

// The merge base of HEAD with the default branch: origin's HEAD when it
// names one, else the local `main`.
async function mergeBase(ports: CommandPorts): Promise<string | undefined> {
	const symref = await runGitText(ports, [
		"git",
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
	]);
	const named = symref.ok ? symref.value.trim().split("/").pop() : undefined;
	const candidates =
		named === undefined || named === ""
			? ["main"]
			: [`origin/${named}`, named, "main"];
	for (const candidate of candidates) {
		const merged = await runGitText(ports, [
			"git",
			"merge-base",
			"HEAD",
			candidate,
		]);
		if (merged.ok && merged.value.trim() !== "") {
			return merged.value.trim();
		}
	}
	return undefined;
}

async function stagedBugs(
	ports: CommandPorts,
	historyFiles: ReadonlyArray<string>,
): Promise<Array<string>> {
	const bugs: Array<string> = [];
	for (const file of historyFiles) {
		const diff = await runGitText(ports, [
			"git",
			"diff",
			"--cached",
			"-U0",
			"--",
			file,
		]);
		if (!diff.ok) {
			continue;
		}
		for (const line of lines(diff.value)) {
			const found = BUG_LINE.exec(line);
			if (found?.[1] !== undefined) {
				bugs.push(found[1]);
			}
		}
	}
	return bugs;
}

async function bugRowMoved(
	ports: CommandPorts,
	historyFiles: ReadonlyArray<string>,
): Promise<boolean> {
	const bugs = await stagedBugs(ports, historyFiles);
	const base = await mergeBase(ports);
	if (bugs.length === 0 || base === undefined) {
		return false;
	}
	for (const bug of bugs) {
		const now = await rowStatus(ports, bug, undefined);
		const before = await rowStatus(ports, bug, base);
		if ((now === "fixed" || now === "wontfix") && before === "open") {
			return true;
		}
	}
	return false;
}

export async function observeRecordEvidence(
	ports: CommandPorts,
	task: TaskRecord,
): Promise<RecordEvidence> {
	const staged = await runGitText(ports, [
		"git",
		"diff",
		"--cached",
		"--name-only",
		"--diff-filter=ACMR",
		"--",
	]);
	const historyFiles = staged.ok
		? lines(staged.value).filter(
				(file) =>
					file.startsWith("docs/HISTORY/") &&
					file.endsWith(".md") &&
					!file.slice("docs/HISTORY/".length).includes("/"),
			)
		: [];
	return {
		historyStaged: historyFiles.length > 0,
		bugRowUpdated:
			task.type === "fix" && (await bugRowMoved(ports, historyFiles)),
	};
}
