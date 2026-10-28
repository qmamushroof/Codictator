// SPEC §4.4.5 execution and safety: argv expansion, 24 KB batching,
// dash-prefixing, the version probe and batch execution. Parsing lives in
// external-output.ts; orchestration lives in external.ts.

import type { CdxError, Ports, ProcResult } from "../../../kernel/index.ts";
import {
	makeError,
	sha256Text,
	stableStringify,
} from "../../../kernel/index.ts";
import type { ExternalInput, ToolDecl } from "./external.ts";

export const COMMAND_LINE_LIMIT = 24576;
export const OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

// SPEC §4.4.5: a path starting with `-` is passed as `./-…` so it never
// parses as a flag; every placeholder expands to separate argv entries.
export function safePath(path: string): string {
	return path.startsWith("-") ? `./${path}` : path;
}

export function commandLength(argv: ReadonlyArray<string>): number {
	return argv.reduce((total, entry) => total + entry.length + 1, 0);
}

export function expandTemplate(
	template: ReadonlyArray<string>,
	files: ReadonlyArray<string>,
	single: string | undefined,
	outPath: string,
): Array<string> {
	const expanded: Array<string> = [];
	for (const entry of template) {
		if (entry === "{files}" || entry === "{staged}") {
			for (const file of files) {
				expanded.push(safePath(file));
			}
		} else if (entry === "{file}") {
			if (single !== undefined) {
				expanded.push(safePath(single));
			}
		} else if (entry === "{root}") {
			expanded.push(".");
		} else if (entry === "{out}") {
			expanded.push(outPath);
		} else {
			expanded.push(entry);
		}
	}
	return expanded;
}

// SPEC §4.4.8 EC-10: {files}/{staged} expansions batch so no command line
// exceeds 24 KB; results merge. A single path longer than the budget still
// runs alone rather than being split.
export function batchFiles(
	fixedLength: number,
	files: ReadonlyArray<string>,
): Array<Array<string>> {
	const batches: Array<Array<string>> = [];
	let current: Array<string> = [];
	let length = fixedLength;
	for (const file of files) {
		const entry = commandLength([safePath(file)]);
		if (current.length > 0 && length + entry > COMMAND_LINE_LIMIT) {
			batches.push(current);
			current = [];
			length = fixedLength;
		}
		current.push(file);
		length += entry;
	}
	if (current.length > 0) {
		batches.push(current);
	}
	return batches;
}

export interface BatchRun {
	readonly argv: ReadonlyArray<string>;
	readonly stdin: string | undefined;
	readonly outPath: string | undefined;
}

export function planRuns(
	tool: ToolDecl,
	input: ExternalInput,
	files: ReadonlyArray<string>,
	stdin: string | undefined,
	outBase: string,
): Array<BatchRun> {
	const template = tool.command;
	const hasOut = template.includes("{out}");
	const outName = (index: number): string => `${outBase}-${String(index)}.json`;
	if (input === "file") {
		return files.map((file, index) => ({
			argv: expandTemplate(template, [], file, outName(index)),
			stdin: undefined,
			outPath: hasOut ? outName(index) : undefined,
		}));
	}
	const filesPlaceholder =
		input === "staged" ? "{staged}" : input === "files" ? "{files}" : undefined;
	if (filesPlaceholder === undefined) {
		return [
			{
				argv: expandTemplate(template, [], undefined, outName(0)),
				stdin,
				outPath: hasOut ? outName(0) : undefined,
			},
		];
	}
	const fixed = expandTemplate(template, [], undefined, outName(0));
	const batches = batchFiles(commandLength(fixed), files);
	if (batches.length === 0) {
		return [{ argv: fixed, stdin, outPath: undefined }];
	}
	return batches.map((batch, index) => ({
		argv: expandTemplate(template, batch, undefined, outName(index)),
		stdin,
		outPath: hasOut ? outName(index) : undefined,
	}));
}

export interface BatchRequest {
	readonly argv: ReadonlyArray<string>;
	readonly stdin: string | undefined;
	readonly outPath: string | undefined;
	readonly timeoutMs: number;
	readonly env: Readonly<Record<string, string>>;
}

export type BatchOutcome =
	| {
			readonly ok: true;
			readonly code: number;
			readonly timedOut: boolean;
			readonly truncated: boolean;
			readonly text: string;
	  }
	| { readonly ok: false; readonly error: CdxError };

function outcomeError(detail: string): BatchOutcome {
	const error = makeError(
		"CDX-E207",
		detail,
		"Fix the external tool or its binding, then retry the hook.",
	);
	return { ok: false, error };
}

// SPEC §4.4.5: output comes from stdout or the {out} temp file the tool
// wrote; the file is deleted after reading. A spawn failure is E209;
// timeout, truncation and code flow to the caller for E902/E207 mapping.
export async function executeBatch(
	ports: Ports,
	request: BatchRequest,
): Promise<BatchOutcome> {
	let result: ProcResult;
	try {
		const baseOptions = {
			cwd: ".",
			env: request.env,
			timeoutMs: request.timeoutMs,
			maxOutputBytes: OUTPUT_CAP_BYTES,
		};
		result =
			request.stdin === undefined
				? await ports.proc.run(request.argv, baseOptions)
				: await ports.proc.run(request.argv, {
						...baseOptions,
						stdin: request.stdin,
					});
	} catch {
		const error = makeError(
			"CDX-E209",
			"the external tool could not start",
			"Install the tool the pack binds, then retry the hook.",
		);
		return { ok: false, error };
	}
	if (result.timedOut || result.truncated) {
		return {
			ok: true,
			code: result.code,
			timedOut: result.timedOut,
			truncated: result.truncated,
			text: "",
		};
	}
	// SPEC §4.4.5: the spawn-failure convention (NodeProc finishes -1 when
	// the executable never starts) means the tool is not installed; the
	// caller maps it to CDX-E209. A timeout resolve first, above.
	if (result.code === -1) {
		const error = makeError(
			"CDX-E209",
			"the external tool could not start",
			"Install the tool the pack binds, then retry the hook.",
		);
		return { ok: false, error };
	}
	if (request.outPath === undefined) {
		return {
			ok: true,
			code: result.code,
			timedOut: false,
			truncated: false,
			text: result.stdout,
		};
	}
	const loaded = await ports.fs.readText(request.outPath);
	await ports.fs.remove(request.outPath);
	if (!loaded.ok) {
		return outcomeError("the tool output file is unreadable");
	}
	return {
		ok: true,
		code: result.code,
		timedOut: false,
		truncated: false,
		text: loaded.value,
	};
}

export function digestArgv(argv: ReadonlyArray<string>): string {
	return sha256Text(stableStringify([...argv]));
}
