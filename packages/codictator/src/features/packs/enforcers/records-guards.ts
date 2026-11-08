// SPEC §5.8 F15 defect plus §5.11 F12 file-naming enforcers (decl module
// records): marker-first fixtures flag here and real scopes judge task
// records with bug rows. History resolvers stay split in
// records-history-guards.ts, re-exported so rule ids keep working.
import type { Ports } from "../../../kernel/index.ts";
import { ok, type Result } from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import { type BugRow, parseBugFile } from "../../records/bug-grammar.ts";
import {
	checkBugRegistry,
	checkDiagnoseBeforeFix,
} from "../../records/bug-registry.ts";
import { parseHistoryEntries } from "../../records/history-parse.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor } from "./binding.ts";
import { baseEnforcer, scopeMarkerTexts } from "./health-measures.ts";
import {
	type MarkerRealArgs,
	markerGuard,
	markerKeyJudge,
	markerRealGuard,
	markerRegexJudge,
} from "./marker-scan.ts";
import { isHistoryFile, realTexts } from "./records-history-guards.ts";
import {
	collectTaskFindings,
	implementationBegan,
	readTasksForScope,
} from "./scope-tasks.ts";

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
	const tasks = (await readTasksForScope(ports, files)).filter(
		(task) => task.type === "fix" && implementationBegan(task),
	);
	if (tasks.length === 0) {
		return [];
	}
	const newest = newestBugField(texts);
	const bugFiles = files.filter((file) => file.startsWith("docs/BUGS/"));
	const rows = collectBugRows(bugFiles, texts);
	const regressionExists = await existingRegressionTests(ports, rows);
	const findings: Array<Finding> = [];
	for (const task of tasks) {
		findings.push(
			...checkBugRegistry(
				{ type: task.type, bug: newest, diagnosis: task.diagnosis },
				rows,
				regressionExists,
				historyFallback(texts, task.id),
			),
		);
	}
	return findings;
}

function newestBugField(
	texts: ReadonlyMap<string, string>,
): string | undefined {
	const historyFile = [...texts.keys()]
		.filter((file) => isHistoryFile(file))
		.sort()[0];
	const newest =
		historyFile === undefined
			? undefined
			: parseHistoryEntries(texts.get(historyFile) ?? "").entries[0];
	const raw = newest?.fields.get("Bug") ?? "";
	return raw === "" ? undefined : raw;
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

function historyFallback(
	texts: ReadonlyMap<string, string>,
	taskId: string,
): string {
	const historyFile = [...texts.keys()]
		.filter((file) => isHistoryFile(file))
		.sort()[0];
	return historyFile ?? `(task ${taskId})`;
}

async function diagnoseBeforeFixReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	return collectTaskFindings(ports, files, (task, findings) => {
		if (task.type !== "fix" || !implementationBegan(task)) {
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

export function resolveBugRowsImmutable(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return markerGuard(
		decl,
		rule,
		ports,
		markerRegexJudge(
			/^[ \t]*edited:/m,
			(file) => `closed bug row edited in ${file}`,
		),
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
				...(await diagnoseBeforeFixReal(args.ports, args.files)),
			);
		},
	);
}

function isKebabStem(stem: string): boolean {
	return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
}

function judgedStem(base: string): string {
	const testAt = base.toLowerCase().indexOf(".test.");
	if (testAt >= 0) {
		return base.slice(0, testAt);
	}
	const dot = base.lastIndexOf(".");
	return dot < 0 ? base : base.slice(0, dot);
}

function frameworkReserved(base: string): boolean {
	return base.startsWith("[") || base.startsWith("+") || base.startsWith("_");
}

export function resolveFileNaming(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const name = markers.get("file") ?? "";
				if (name === "") {
					continue;
				}
				const base = name.split("/").pop() ?? name;
				if (frameworkReserved(base)) {
					continue;
				}
				const stem = judgedStem(base);
				if (isKebabStem(stem)) {
					continue;
				}
				findings.push(
					findingFor(binding, {
						path: file,
						message: `file stem "${stem}" is not kebab-case`,
						vars: { path: file },
					}),
				);
			}
			return findings;
		}),
	);
}
