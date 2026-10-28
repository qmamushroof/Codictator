// SPEC §4.7.2: the shell analyser's public shape. The parser driver
// lives in shell-scan.ts, word lexing in shell-word.ts and command
// elaboration in shell-cmd.ts; the deny classes own shell-deny.ts. Pure
// string processing, so every module can analyse without importing
// security (§3.3).
export interface SimpleCommand {
	readonly name: string;
	readonly argv: ReadonlyArray<string>;
	readonly raw: string;
	readonly elevated: boolean;
	readonly embedded: ReadonlyArray<string>;
}

export interface ShellPipeline {
	readonly commands: ReadonlyArray<SimpleCommand>;
}

export interface ShellAnalysis {
	readonly pipelines: ReadonlyArray<ShellPipeline>;
	readonly writeTargets: ReadonlyArray<string>;
	readonly inputs: ReadonlyArray<string>;
}

export interface Collector {
	readonly pipelines: Array<ShellPipeline>;
	readonly writeTargets: Array<string>;
	readonly inputs: Array<string>;
}

export class ParseFailure extends Error {}
