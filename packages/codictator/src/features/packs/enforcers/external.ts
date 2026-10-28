// SPEC §4.4.5 + §7.2: the external-tool contract types. Declaration
// narrowing lives in external-bind.ts, run planning in external-runs.ts,
// parsing in external-output.ts and the check in external-check.ts.
import type { JsonSelect, OutputFormat } from "./external-output.ts";

export interface ToolVersion {
	readonly pin: string;
	readonly probe: ReadonlyArray<string>;
	readonly pattern: string;
}

// SPEC §7.2 config.tools row, narrowed at load. role "enforcer" verdicts;
// any helper role bound as an enforcer fails the load (it cannot verdict).
export interface ToolDecl {
	readonly id: string;
	readonly command: ReadonlyArray<string>;
	readonly version: ToolVersion;
	readonly role: string | undefined;
	readonly timeoutMs: number;
	readonly envPass: ReadonlyArray<string>;
}

export type ExternalInput =
	| "file"
	| "files"
	| "staged"
	| "diff"
	| "repo"
	| "stdin-json";

const EXTERNAL_INPUTS: ReadonlyArray<string> = [
	"file",
	"files",
	"staged",
	"diff",
	"repo",
	"stdin-json",
];

export function isExternalInput(value: string): value is ExternalInput {
	return EXTERNAL_INPUTS.includes(value);
}

export interface ExternalOutput {
	readonly format: OutputFormat;
	readonly source: "stdout" | "{out}";
	readonly select: JsonSelect | undefined;
	readonly pattern: RegExp | undefined;
}

export interface ExternalArgs {
	readonly input: ExternalInput;
	readonly output: ExternalOutput;
	readonly passCodes: ReadonlyArray<number>;
	readonly findingCodes: ReadonlyArray<number>;
	readonly timeoutMs: number | undefined;
}

export interface ToolEvent {
	readonly toolId: string;
	readonly version: string;
	readonly argvDigest: string;
	readonly exitCode: number;
	readonly findingCount: number;
}

export interface ExternalOptions {
	readonly onToolEvent?: (event: ToolEvent) => void;
}
