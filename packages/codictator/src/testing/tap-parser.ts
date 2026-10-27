// SPEC §10.7: minimal TAP reader for `node --test --test-reporter=tap` output.
// Test stdout arrives `#`-prefixed, so comment lines can never forge results.
export interface TapOutcome {
	readonly title: string;
	readonly passed: boolean;
}

export interface TapFileResult {
	readonly outcomes: readonly TapOutcome[];
	readonly loadFailed: boolean;
}

interface OpenSubtest {
	readonly name: string;
	readonly indent: number;
	hasChildren: boolean;
}

function unescapeTapName(name: string): string {
	return name.replace(/\\\\/g, "\\");
}

function countIndent(line: string): number {
	let indent = 0;
	while (line.charCodeAt(indent) === 32) {
		indent += 1;
	}
	return indent;
}

function openChild(parent: Array<OpenSubtest>): void {
	const top = parent[parent.length - 1];
	if (top !== undefined) {
		top.hasChildren = true;
	}
}

function closeSubtests(stack: Array<OpenSubtest>, indent: number): void {
	while (stack.length > 0) {
		const top = stack[stack.length - 1];
		if (top === undefined || top.indent <= indent) {
			return;
		}
		stack.pop();
	}
}

function recordResult(
	stack: Array<OpenSubtest>,
	indent: number,
	name: string,
	passed: boolean,
	outcomes: Array<TapOutcome>,
): boolean {
	closeSubtests(stack, indent);
	const top = stack[stack.length - 1];
	if (top !== undefined && top.indent === indent && top.name === name) {
		stack.pop();
		if (!top.hasChildren) {
			outcomes.push({
				title: stack
					.map((entry) => entry.name)
					.concat(name)
					.join(" > "),
				passed,
			});
		}
		return top.hasChildren;
	}
	outcomes.push({
		title: stack
			.map((entry) => entry.name)
			.concat(name)
			.join(" > "),
		passed,
	});
	return false;
}

export function parseTap(tap: string, filePath: string): TapFileResult {
	const stack: Array<OpenSubtest> = [];
	const outcomes: Array<TapOutcome> = [];
	for (const rawLine of tap.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		const trimmed = line.trimStart();
		if (trimmed.startsWith("# Subtest: ")) {
			openChild(stack);
			stack.push({
				name: unescapeTapName(trimmed.slice("# Subtest: ".length).trimEnd()),
				indent: countIndent(line),
				hasChildren: false,
			});
			continue;
		}
		if (trimmed.startsWith("#")) {
			continue;
		}
		const match = /^( *)(not )?ok [0-9]+ - (.*)$/.exec(line);
		if (match === null) {
			continue;
		}
		const indent = (match[1] ?? "").length;
		const passed = match[2] === undefined;
		const name = unescapeTapName((match[3] ?? "").trimEnd());
		recordResult(stack, indent, name, passed, outcomes);
	}
	const leaves = outcomes.filter((outcome) => outcome.title !== filePath);
	const fileLevelFailed = outcomes.some(
		(outcome) => outcome.title === filePath && !outcome.passed,
	);
	return {
		outcomes: leaves,
		loadFailed: fileLevelFailed && leaves.length === 0,
	};
}
