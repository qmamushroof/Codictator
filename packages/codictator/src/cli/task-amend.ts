// Split from task-advance.ts by responsibility (core/file-size): this
// module owns the `task amend` merge; dispatch stays in task-advance.ts.
import type { TaskRecord } from "../features/workflow/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import { printHuman, usageError } from "./shared.ts";
import { taskLine } from "./tasks.ts";
import { writeTask } from "./tasks.ts";

export async function taskAmend(
	req: CommandRequest,
	root: string,
	task: TaskRecord,
	title: string | undefined,
	type: string | undefined,
	allow: ReadonlyArray<string> | undefined,
	setAllow: ReadonlyArray<string> | undefined,
	spec: ReadonlyArray<string> | undefined,
	setSpec: ReadonlyArray<string> | undefined,
	diagnosis: string | undefined,
	accept: ReadonlyArray<string> | undefined,
	test: ReadonlyArray<string> | undefined,
	setTests: ReadonlyArray<string> | undefined,
	historyStaged: boolean,
	bugRowUpdated: boolean,
): Promise<Result<number>> {
	if (
		title === undefined &&
		type === undefined &&
		allow === undefined &&
		setAllow === undefined &&
		spec === undefined &&
		setSpec === undefined &&
		diagnosis === undefined &&
		accept === undefined &&
		test === undefined &&
		setTests === undefined &&
		historyStaged === false &&
		bugRowUpdated === false
	) {
		return usageError(
			"usage: codictator task amend --id <T-####> [--title <t>] [--type <t>] [--allow <glob> ...] [--set-allow <glob> ...] [--spec <ref> ...] [--set-spec <ref> ...] [--diagnosis <text>] [--accept <criterion> ...] [--test <path::title::kind> ...] [--set-tests <path::title::kind> ...] [--history-staged] [--bug-row-updated]",
		);
	}
	const parseTestRef = (raw: string): { path: string; title: string; kind: string } => {
		const parts = raw.split("::");
		const path = parts[0] ?? raw;
		const testTitle = parts[1] ?? raw;
		const kind = parts[2] ?? "regression";
		return { path, title: testTitle, kind };
	};
	const appendedTests =
		test === undefined ? undefined : test.map(parseTestRef);
	const replacedTests =
		setTests === undefined ? undefined : setTests.map(parseTestRef);
	const amended: TaskRecord = {
		...task,
		...(title === undefined ? {} : { title }),
		...(type === undefined ? {} : { type }),
		...(allow === undefined
			? {}
			: { files: { allow: [...task.files.allow, ...allow] } }),
		// SPEC §4.12.2: amend is append-only, except --set-allow/--set-spec
		// which replace the list so a polluted plan is cleaned by command,
		// never by hand-editing the task JSON (§4.14.3).
		...(setAllow === undefined
			? {}
			: { files: { allow: [...setAllow] } }),
		...(spec === undefined ? {} : { spec: [...task.spec, ...spec] }),
		...(setSpec === undefined ? {} : { spec: [...setSpec] }),
		...(diagnosis === undefined ? {} : { diagnosis }),
		...(accept === undefined
			? {}
			: { acceptanceCriteria: [...task.acceptanceCriteria, ...accept] }),
		...(appendedTests === undefined
			? {}
			: { tests: [...(task.tests ?? []), ...appendedTests] }),
		...(replacedTests === undefined ? {} : { tests: [...replacedTests] }),
		...(historyStaged === false ? {} : { historyStaged: true }),
		...(bugRowUpdated === false ? {} : { bugRowUpdated: true }),
	};
	const saved = await writeTask(root, amended);
	if (!saved.ok) {
		return saved;
	}
	printHuman(`amended ${taskLine(amended)}`, req.quiet);
	return ok(0);
}
