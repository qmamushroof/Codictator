// SPEC §4.7.2: the shell parser driver. The main loop dispatches each
// position to the word scanners (shell-word.ts) or a boundary; finished
// word lists become commands through the elaborator (shell-cmd.ts).
// Pipelines split on ;, &&, ||, |, & and newlines; $(…), backticks,
// groupings and heredocs descend inline.
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";
import {
	type Collector,
	ParseFailure,
	type ShellAnalysis,
	type SimpleCommand,
} from "./shell.ts";
import { buildShellCommand } from "./shell-cmd.ts";
import {
	readShellBalanced,
	readShellHeredoc,
	readShellOperator,
	readShellQuoted,
	readShellWord,
	skipShellComment,
} from "./shell-word.ts";

function unparseable(): Result<never> {
	return err(
		makeError(
			"CDX-E306",
			"shell command is unparseable (unbalanced quote or unfinished construct)",
			"Rewrite the command with balanced quotes and no heredoc without a terminator, then retry.",
		),
	);
}

function newCollector(): Collector {
	return { pipelines: [], writeTargets: [], inputs: [] };
}

class ShellParser {
	private index = 0;
	private current: Array<string> = [];
	private commandStart = 0;
	private pipeline: Array<SimpleCommand> = [];
	private heredocBodies: Array<string> = [];
	private readonly text: string;
	private readonly collect: Collector;

	constructor(text: string, collect: Collector) {
		this.text = text;
		this.collect = collect;
	}

	parse(): void {
		this.commandStart = 0;
		while (this.index < this.text.length) {
			this.parseStep();
		}
		this.endCommand();
		this.endPipeline();
	}

	private parseStep(): void {
		const char = this.text[this.index];
		if (char === " " || char === "\t") {
			this.index += 1;
			return;
		}
		if (char === "#") {
			this.index = skipShellComment(this.text, this.index);
			return;
		}
		if (char !== undefined && this.parseQuotedStart(char)) {
			return;
		}
		if (char !== undefined && this.parseBoundaryStart(char)) {
			return;
		}
		if (char !== undefined && this.parseGroupStart(char)) {
			return;
		}
		this.parseWordOrOperator();
	}

	private parseSubstitutionStart(char: string): boolean {
		const next = this.text[this.index + 1];
		if (next !== "(" || (char !== "$" && char !== "<" && char !== ">")) {
			return false;
		}
		const inner = readShellBalanced(this.text, this.index + 2, ")");
		ShellParser.descendText(inner.value, this.collect);
		this.current.push(inner.value);
		this.index = inner.next;
		return true;
	}

	private parseQuotedStart(char: string): boolean {
		if (char === "'" || char === '"' || char === "`") {
			const read = readShellQuoted(this.text, this.index, (inner) =>
				ShellParser.descendText(inner, this.collect),
			);
			this.current.push(read.value);
			this.index = read.next;
			return true;
		}
		return this.parseSubstitutionStart(char);
	}

	private endBoundary(pipelineToo: boolean, skip: number): void {
		this.endCommand();
		if (pipelineToo) {
			this.endPipeline();
		}
		this.index += skip;
		this.commandStart = this.index;
	}

	private parseBoundaryStart(char: string): boolean {
		if (char === "\n") {
			this.endBoundary(true, 1);
			return true;
		}
		if (char === "&" && this.text[this.index + 1] === "&") {
			this.endBoundary(true, 2);
			return true;
		}
		if (char === "|" && this.text[this.index + 1] === "|") {
			this.endBoundary(true, 2);
			return true;
		}
		if (char === "|" && this.text[this.index + 1] === "&") {
			this.endBoundary(false, 2);
			return true;
		}
		if (char === "|") {
			this.endBoundary(false, 1);
			return true;
		}
		if (char === ";" || char === "&") {
			const skip = char === ";" && this.text[this.index + 1] === ";" ? 2 : 1;
			this.endBoundary(true, skip);
			return true;
		}
		return false;
	}

	private parseGroupStart(char: string): boolean {
		if (char === "(" || char === "{") {
			const close = char === "(" ? ")" : "}";
			const inner = readShellBalanced(this.text, this.index + 1, close);
			if (char === "(" && this.current.length === 0) {
				this.endPipeline();
			}
			ShellParser.descendText(inner.value, this.collect);
			this.index = inner.next;
			this.commandStart = this.index;
			return true;
		}
		if (char === ")" || char === "}") {
			throw new ParseFailure();
		}
		return false;
	}

	private parseWordOrOperator(): void {
		const last =
			this.current.length > 0
				? this.current[this.current.length - 1]
				: undefined;
		const operator = readShellOperator(this.text, this.index, last);
		if (operator === undefined) {
			const word = readShellWord(this.text, this.index, (inner) =>
				ShellParser.descendText(inner, this.collect),
			);
			this.current.push(word.value);
			this.index = word.next;
			return;
		}
		if (operator.dropFd) {
			this.current.pop();
		}
		this.index = operator.next;
		this.handleRedirection(operator.operator);
	}

	private handleRedirection(operator: string): void {
		while (
			this.index < this.text.length &&
			(this.text[this.index] === " " || this.text[this.index] === "\t")
		) {
			this.index += 1;
		}
		if (this.index >= this.text.length) {
			throw new ParseFailure();
		}
		const char = this.text[this.index];
		let target: string;
		if (char === "'" || char === '"') {
			const read = readShellQuoted(this.text, this.index, (inner) =>
				ShellParser.descendText(inner, this.collect),
			);
			target = read.value;
			this.index = read.next;
		} else {
			const word = readShellWord(this.text, this.index, (inner) =>
				ShellParser.descendText(inner, this.collect),
			);
			target = word.value;
			this.index = word.next;
		}
		if (target === "") {
			throw new ParseFailure();
		}
		if (operator === "<<" || operator === "<<-") {
			const body = readShellHeredoc(
				this.text,
				this.index,
				target,
				operator === "<<-",
			);
			this.heredocBodies.push(body.value);
			this.index = body.next;
		} else if (operator === "<") {
			this.collect.inputs.push(target);
		} else if (operator !== "<<<") {
			this.collect.writeTargets.push(target);
		}
	}

	private endCommand(): void {
		const words = this.current;
		this.current = [];
		const bodies = this.heredocBodies;
		this.heredocBodies = [];
		if (words.length === 0) {
			return;
		}
		const raw = this.text.slice(this.commandStart, this.index).trim();
		this.commandStart = this.index;
		buildShellCommand(this.pipeline, words, raw, false, bodies, (inner) =>
			ShellParser.descendText(inner, this.collect),
		);
	}

	private endPipeline(): void {
		if (this.pipeline.length > 0) {
			this.collect.pipelines.push({ commands: this.pipeline });
			this.pipeline = [];
		}
	}

	static descendText(inner: string, collect: Collector): void {
		const nested = new ShellParser(inner, collect);
		nested.parse();
	}
}

// SPEC §4.7.2: tokenise without executing; unbalanced quotes, heredocs
// without a terminator and other unfinished constructs fail CDX-E306.
export function analyseShell(command: string): Result<ShellAnalysis> {
	const collect = newCollector();
	try {
		const parser = new ShellParser(command.replace(/\r\n?/g, "\n"), collect);
		parser.parse();
	} catch (error) {
		if (error instanceof ParseFailure) {
			return unparseable();
		}
		throw error;
	}
	const pipelines = collect.pipelines.filter(
		(pipeline) => pipeline.commands.length > 0,
	);
	return ok({
		pipelines,
		writeTargets: [...collect.writeTargets],
		inputs: [...collect.inputs],
	});
}
