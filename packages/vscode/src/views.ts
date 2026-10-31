// SPEC §4.20.2: Active rules and Violations views plus L2 on save. Every
// view is data from the repo-pinned engine over stdio (§7.15); this module
// owns the shaping, the engine itself owns the verdicts. Timeline lives in
// timeline.ts so each view module stays small.
import type { EngineRequest } from "./engine-client.ts";
import {
	arrayFieldOf,
	engineRequestFor,
	isRecord,
	numberFieldOf,
	stringFieldOf,
} from "./engine-client.ts";
import type { TimelineDisposable } from "./timeline.ts";

// SPEC §4.20.2 + EC-1: one group per folder and pack, so a multi-root
// workspace never mixes two repos in one row.
export interface RuleGroup {
	readonly folder: string;
	readonly pack: string;
	readonly rules: ReadonlyArray<string>;
}

// SPEC §4.20.2: a Problems-panel diagnostic carries the rule id as code,
// the remediation as message, and a pointer to `explain`.
export interface DiagnosticEntry {
	readonly uri: string;
	readonly code: string;
	readonly message: string;
	readonly line?: number;
}

// The narrow port the views need from the vscode diagnostic collection.
export interface DiagnosticSink {
	set(uri: string, entries: ReadonlyArray<DiagnosticEntry>): void;
	deleteFile(uri: string): void;
}

export interface RefreshPorts {
	readonly request?: EngineRequest;
	readonly sink?: DiagnosticSink;
}

export interface VerifyPorts {
	readonly request?: EngineRequest;
	readonly sink?: DiagnosticSink;
	readonly clock?: () => number;
}

export interface SaveEvent {
	readonly folderPath: string;
	readonly filePath: string;
}

export interface SaveApi {
	onDidSave(listener: (event: SaveEvent) => void): TimelineDisposable;
}

// SPEC §4.20.2 EC-1: diagnostics stay keyed per folder.
const folderDiagnostics = new Map<
	string,
	Map<string, Array<DiagnosticEntry>>
>();

export function diagnosticsForFolder(
	folderPath: string,
): ReadonlyMap<string, ReadonlyArray<DiagnosticEntry>> {
	return folderDiagnostics.get(folderPath) ?? new Map();
}

function uriFor(folderPath: string, filePath: string): string {
	return `${folderPath}/${filePath}`;
}

function clearFileDiagnostics(
	folderPath: string,
	filePath: string,
	sink?: DiagnosticSink,
): void {
	const uri = uriFor(folderPath, filePath);
	const held = folderDiagnostics.get(folderPath);
	if (held !== undefined) {
		held.delete(uri);
		if (held.size === 0) {
			folderDiagnostics.delete(folderPath);
		}
	}
	sink?.deleteFile(uri);
}

// SPEC §4.20.2: Active rules view data (packs, tiers, bounds) over
// `rules/list`. Effective params, waivers and coverage ride the engine
// answer; the view groups them by folder (EC-1) and pack.
export async function listRuleGroups(
	folders: ReadonlyArray<string>,
	request?: EngineRequest,
): Promise<Array<RuleGroup>> {
	const client = engineRequestFor(request);
	const groups: Array<RuleGroup> = [];
	for (const folderPath of [...folders].sort()) {
		const answer = await client(folderPath, "rules/list", {});
		const packs = new Map<string, Array<string>>();
		for (const entry of arrayFieldOf(answer, "rules")) {
			if (!isRecord(entry)) {
				continue;
			}
			const id = stringFieldOf(entry, "id");
			if (id === undefined || id === "") {
				continue;
			}
			const pack = stringFieldOf(entry, "pack") ?? "unknown@0.0.0";
			const listed = packs.get(pack) ?? [];
			if (!listed.includes(id)) {
				listed.push(id);
			}
			packs.set(pack, listed);
		}
		const ordered = [...packs.entries()].sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
		for (const [pack, rules] of ordered) {
			groups.push({ folder: folderPath, pack, rules: [...rules].sort() });
		}
	}
	return groups;
}

// SPEC §4.20.2: Violations view diagnostics over `findings/list`. Findings
// without a path (EC-8, a save outside every module) keep their
// `core/arch-module-mapped` diagnostic instead of being dropped.
export async function refreshViolationDiagnostics(
	folderPath: string,
	ports?: RefreshPorts,
): Promise<number> {
	const answer = await engineRequestFor(ports?.request)(
		folderPath,
		"findings/list",
		{},
	);
	const byUri = new Map<string, Array<DiagnosticEntry>>();
	for (const entry of arrayFieldOf(answer, "findings")) {
		if (!isRecord(entry)) {
			continue;
		}
		const ruleId = stringFieldOf(entry, "ruleId");
		if (ruleId === undefined || ruleId === "") {
			continue;
		}
		const remediation =
			stringFieldOf(entry, "remediation") ??
			stringFieldOf(entry, "message") ??
			ruleId;
		const path = stringFieldOf(entry, "path") ?? "<unmapped>";
		const uri = uriFor(folderPath, path);
		const line = numberFieldOf(entry, "line");
		const diagnostic: DiagnosticEntry =
			line === undefined
				? {
						uri,
						code: ruleId,
						message: `${remediation} (codictator explain ${ruleId})`,
					}
				: {
						uri,
						code: ruleId,
						message: `${remediation} (codictator explain ${ruleId})`,
						line,
					};
		const listed = byUri.get(uri) ?? [];
		listed.push(diagnostic);
		byUri.set(uri, listed);
	}
	const previous = folderDiagnostics.get(folderPath) ?? new Map();
	const sink = ports?.sink;
	if (sink !== undefined) {
		for (const uri of previous.keys()) {
			if (!byUri.has(uri)) {
				sink.deleteFile(uri);
			}
		}
		for (const [uri, entries] of byUri) {
			sink.set(uri, entries);
		}
	}
	folderDiagnostics.set(folderPath, byUri);
	let total = 0;
	for (const entries of byUri.values()) {
		total += entries.length;
	}
	return total;
}

const SAVE_DEBOUNCE_MS = 200;

const saveHistory = new Map<string, { at: number; verdict: string }>();

let fallbackClock: () => number = () => Date.now();

export function resetSaveHistory(): void {
	saveHistory.clear();
	fallbackClock = () => Date.now();
}

// SPEC §4.20.2 L2 on save: verify with layer L2 for the saved file and
// refresh diagnostics; the save itself is never blocked. Passing files
// clear their diagnostics; anything else refreshes the folder view.
export async function verifyFileOnSave(
	folderPath: string,
	filePath: string,
	ports?: VerifyPorts,
): Promise<string> {
	const clock = ports?.clock ?? fallbackClock;
	const now = clock();
	const key = `${folderPath}\n${filePath}`;
	const prior = saveHistory.get(key);
	if (prior !== undefined && now - prior.at < SAVE_DEBOUNCE_MS) {
		return prior.verdict;
	}
	const answer = await engineRequestFor(ports?.request)(folderPath, "verify", {
		layer: "L2",
		files: [filePath],
	});
	const verdict = stringFieldOf(answer, "verdict") ?? "unknown";
	saveHistory.set(key, { at: now, verdict });
	if (verdict === "allow") {
		clearFileDiagnostics(folderPath, filePath, ports?.sink);
	} else {
		await refreshViolationDiagnostics(folderPath, ports);
	}
	return verdict;
}

// SPEC §4.20.2 L2 on save wiring: the handler fires the verify without
// awaiting it, so the save completes first. Verify never writes files, so
// no save→verify→save loop can form.
export function registerL2OnSave(
	api: SaveApi,
	ports?: VerifyPorts,
): TimelineDisposable {
	return api.onDidSave((event) => {
		void verifyFileOnSave(event.folderPath, event.filePath, ports);
	});
}
