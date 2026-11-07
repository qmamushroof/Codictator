// SPEC §4.20.2 + EC-7: the PR4 Violations polish — file grouping, open at
// line, Problems diagnostics with explain and waive code actions. Red-first:
// views.ts and violation-actions.ts additions do not exist yet.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	groupViolationsByFile,
	refreshViolationDiagnostics,
} from "../../src/views.ts";
import {
	explainActionFor,
	openFindingCommand,
	registerViolationActions,
	type ViolationActionPorts,
	violationCodeActions,
	type WaiveRef,
	waiveCommandLine,
} from "../../src/violation-actions.ts";

interface FakeWaiveTerminal {
	readonly name: string;
	readonly sent: Array<{ text: string; execute: boolean }>;
	shown: boolean;
	sendText(text: string, execute: boolean): void;
	show(): void;
}

async function seedTwoFiles(): Promise<void> {
	await refreshViolationDiagnostics("/repo", {
		request: () =>
			Promise.resolve({
				findings: [
					{
						line: 12,
						message: "fix boundary",
						path: "src/b.ts",
						ruleId: "core/arch-module-mapped",
					},
					{
						line: 3,
						message: "fix boundary",
						path: "src/a.ts",
						ruleId: "core/arch-module-mapped",
					},
					{
						message: "second hit",
						path: "src/a.ts",
						ruleId: "core/no-guard-removal",
					},
				],
			}),
	});
}

test("[§4.20.2] violations group by file with an open command per group", async () => {
	// SPEC §4.20.2 PR4: findings group by file, sorted, each row opening
	// the file at the first finding line.
	await seedTwoFiles();
	const groups = groupViolationsByFile("/repo");
	assert.deepEqual(
		groups.map((group) => group.uri),
		["/repo/src/a.ts", "/repo/src/b.ts"],
	);
	assert.equal(groups[0]?.entries.length, 2);
	const firstUri = groups[0]?.uri ?? "";
	const firstLine = groups[0]?.entries[0]?.line;
	const command =
		firstLine === undefined
			? openFindingCommand({ uri: firstUri })
			: openFindingCommand({ line: firstLine, uri: firstUri });
	assert.equal(command.command, "codictator.openFinding");
	assert.deepEqual(command.args, ["/repo/src/a.ts", 3]);
});

test("[§4.20.4 EC-7] waive pre-fills the waive terminal with rule, file and line and runs nothing", async () => {
	// SPEC §4.20.4 EC-7 PR4: the waive action opens a terminal pre-filled
	// with the exact `codictator waive …` command and executes nothing.
	await seedTwoFiles();
	const ref: WaiveRef = {
		code: "core/arch-module-mapped",
		line: 3,
		uri: "/repo/src/a.ts",
	};
	assert.equal(
		waiveCommandLine(ref),
		"codictator waive --rule core/arch-module-mapped --file /repo/src/a.ts --line 3",
	);
	const terminals: Array<FakeWaiveTerminal> = [];
	const handlers = new Map<string, (...args: Array<unknown>) => unknown>();
	const ports: ViolationActionPorts = {
		createTerminal: (name: string) => {
			const terminal: FakeWaiveTerminal = {
				name,
				sendText: (text: string, execute: boolean): void => {
					terminal.sent.push({ execute, text });
				},
				sent: [],
				show: (): void => {
					terminal.shown = true;
				},
				shown: false,
			};
			terminals.push(terminal);
			return terminal;
		},
		openFileAt: (): void => undefined,
		registerCommand: (
			commandId: string,
			handler: (...args: Array<unknown>) => unknown,
		): void => {
			handlers.set(commandId, handler);
		},
	};
	registerViolationActions(ports);
	const waive = handlers.get("codictator.waiveFinding");
	assert.ok(waive !== undefined);
	waive("/repo/src/a.ts", "core/arch-module-mapped", 3);
	assert.equal(terminals.length, 1);
	const terminal = terminals[0];
	assert.ok(terminal !== undefined);
	assert.equal(terminal.shown, true);
	assert.deepEqual(
		terminal.sent.map((entry) => entry.execute),
		[false],
	);
	assert.match(
		terminal.sent[0]?.text ?? "",
		/^codictator waive --rule core\/arch-module-mapped --file \/repo\/src\/a\.ts --line 3$/,
	);
	const open = handlers.get("codictator.openFinding");
	assert.ok(open !== undefined);
});

test("[§4.20.2] problems entries carry the rule id as code with explain and waive actions", async () => {
	// SPEC §4.20.2 PR4: each diagnostic points at `explain`; the code action
	// pair explains the rule or pre-fills the waive terminal.
	await seedTwoFiles();
	const groups = groupViolationsByFile("/repo");
	const first = groups[0]?.entries[0];
	assert.ok(first !== undefined);
	assert.equal(first.code, "core/arch-module-mapped");
	assert.match(first.message, /codictator explain core\/arch-module-mapped/);
	const actions = violationCodeActions("/repo/src/a.ts", [first]);
	assert.equal(actions.length, 2);
	assert.equal(actions[0]?.command, "codictator.explain");
	assert.equal(actions[1]?.command, "codictator.waiveFinding");
	assert.deepEqual(explainActionFor("core/arch-module-mapped"), {
		args: ["core/arch-module-mapped"],
		command: "codictator.explain",
		title: "Explain rule",
	});
});
