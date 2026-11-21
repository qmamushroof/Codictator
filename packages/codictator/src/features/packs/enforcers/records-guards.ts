// SPEC §5.8 F15 defect enforcers (decl module records): marker-first
// fixtures flag here and real scopes judge task records with bug rows.
// History resolvers stay split in records-history-guards.ts and file-naming
// in file-naming-guard.ts, re-exported so rule ids keep working.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import { type BugRow, parseBugFile } from "../../records/bug-grammar.ts";
import {
	checkBugRegistry,
	checkDiagnoseBeforeFix,
} from "../../records/bug-registry.ts";
import { checkBugRowsImmutable } from "../../records/bug-rows-immutable.ts";
import {
	type HistoryEntry,
	parseHistoryEntries,
} from "../../records/history-parse.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { isMarkerFile } from "./health-measures.ts";
import {
	type MarkerRealArgs,
	markerKeyJudge,
	markerRealGuard,
	markerRegexJudge,
} from "./marker-scan.ts";
import { loadEffectiveText } from "./pre-tool-files.ts";
import { isHistoryFile, realTexts } from "./records-history-guards.ts";
import {
	collectTaskFindings,
	implementationBegan,
	readJudgedTasks,
} from "./scope-tasks.ts";
import { liveSourceWrite } from "./testing-real.ts";

export { resolveFileNaming } from "./file-naming-guard.ts";
export {
	resolveHistoryAppendOnly,
	resolveHistoryEntry,
	resolveHistoryEntryComplete,
} from "./records-history-guards.ts";

async function bugRegistryReal(
	ports: Ports,
	files: ReadonlyArray<string>,
	texts: ReadonlyMap<string, string>,
): Promise<Array<Finding>> {
	const tasks = (await readJudgedTasks(ports, files)).filter(
		(task) => task.type === "fix" && implementationBegan(task),
	);
	if (tasks.length === 0) {
		return [];
	}
	const bugFiles = files.filter((file) => file.startsWith("docs/BUGS/"));
	const rows = collectBugRows(bugFiles, texts);
	const regressionExists = await existingRegressionTests(ports, rows);
	const findings: Array<Finding> = [];
	for (const task of tasks) {
		const own = ownHistoryEntry(texts, task.id);
		const bug = own?.entry.fields.get("Bug") ?? "";
		findings.push(
			...checkBugRegistry(
				{
					type: task.type,
					bug: bug === "" ? undefined : bug,
					diagnosis: task.diagnosis,
				},
				rows,
				regressionExists,
				own?.file ?? `(task ${task.id})`,
			),
		);
	}
	return findings;
}

interface OwnEntry {
	readonly file: string;
	readonly entry: HistoryEntry;
}

// SPEC §4.9.4 + §7.7: a fix task is judged by the history entry that names it
// (its Task field), searching the history files newest first and each file's
// entries in file order. A range may also hold other tasks' entries, so the
// newest entry stands in only when no entry names the task.
function ownHistoryEntry(
	texts: ReadonlyMap<string, string>,
	taskId: string,
): OwnEntry | undefined {
	const files = [...texts.keys()]
		.filter((file) => isHistoryFile(file))
		.sort()
		.reverse();
	const all: Array<OwnEntry> = files.flatMap((file) =>
		parseHistoryEntries(texts.get(file) ?? "").entries.map((entry) => ({
			file,
			entry,
		})),
	);
	return all.find((item) => item.entry.task === taskId) ?? all[0];
}

function collectBugRows(
	bugFiles: ReadonlyArray<string>,
	texts: ReadonlyMap<string, string>,
): Array<BugRow> {
	const rows: Array<BugRow> = [];
	for (const file of bugFiles) {
		const text = texts.get(file);
		if (text === undefined) {
			continue;
		}
		rows.push(...(parseBugFile(text).file?.rows ?? []));
	}
	return rows;
}

async function existingRegressionTests(
	ports: Ports,
	rows: ReadonlyArray<BugRow>,
): Promise<(path: string) => boolean> {
	const existing = new Set<string>();
	for (const row of rows) {
		if (row.regressionTest === "") {
			continue;
		}
		const seen = await ports.fs.exists(row.regressionTest);
		if (seen.ok && seen.value) {
			existing.add(row.regressionTest);
		}
	}
	return (path: string): boolean => existing.has(path);
}

async function diagnoseBeforeFixReal(
	ports: Ports,
	files: ReadonlyArray<string>,
	live: boolean,
): Promise<Array<Finding>> {
	return collectTaskFindings(ports, files, (task, findings) => {
		const owed = live ? liveSourceWrite(files) : implementationBegan(task);
		if (task.type !== "fix" || !owed) {
			return;
		}
		findings.push(
			...checkDiagnoseBeforeFix(
				{ type: task.type, bug: undefined, diagnosis: task.diagnosis },
				`.codictator/tasks/${task.id}.json`,
			),
		);
	});
}

// Module-local factory: the two bug-row resolvers share one call shape
// with distinct keys, so the resolver heads never form a cross-file run.
function recordRule(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	key: string,
	message: (file: string) => string,
	judgeReal: (args: MarkerRealArgs) => Promise<void>,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		markerKeyJudge(key, "none", message),
		judgeReal,
	);
}

export function resolveBugRegistry(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return recordRule(
		decl,
		rule,
		ports,
		"bug-row",
		(file) => `fix with no bug row in ${file}`,
		async (args) => {
			args.findings.push(
				...(await bugRegistryReal(
					args.ports,
					args.files,
					await realTexts(args.ports, args.binding, args.files, args.findings),
				)),
			);
		},
	);
}

// SPEC §4.9.4 + §4.3.2: a real registry write is judged as the file it would
// leave against HEAD; a fragment cannot be compared and a target new since
// HEAD has nothing earlier to edit. A head that no longer parses reads as no
// rows, so every earlier row disappears and blocks.
async function bugRowsImmutableReal(args: MarkerRealArgs): Promise<void> {
	for (const entry of args.effective) {
		const file = entry.path;
		if (
			!file.startsWith("docs/BUGS/") ||
			!file.endsWith(".md") ||
			isMarkerFile(file)
		) {
			continue;
		}
		const base = await args.ports.git.show("HEAD", file);
		if (!base.ok) {
			continue;
		}
		const text = await loadEffectiveText(
			args.ports,
			args.binding,
			entry,
			args.findings,
			"document",
			true,
		);
		const before = parseBugFile(base.value).file;
		if (text === undefined || before === undefined) {
			continue;
		}
		args.findings.push(
			...checkBugRowsImmutable(
				before.rows,
				parseBugFile(text).file?.rows ?? [],
				file,
			),
		);
	}
}

export function resolveBugRowsImmutable(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerRealGuard(
		decl,
		rule,
		ports,
		markerRegexJudge(
			/^[ \t]*edited:/m,
			(file) => `closed bug row edited in ${file}`,
		),
		bugRowsImmutableReal,
	);
}

export function resolveDiagnoseBeforeFix(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return recordRule(
		decl,
		rule,
		ports,
		"diagnosis",
		(file) => `fix with no diagnosis in ${file}`,
		async (args) => {
			args.findings.push(
				...(await diagnoseBeforeFixReal(
					args.ports,
					args.files,
					args.hasToolTargets,
				)),
			);
		},
	);
}
