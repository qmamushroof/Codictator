// SPEC §5.4 real-scope judging for testing: scenario classification plus
// red-proof, kind, and regression checks over the task records that claim
// the scope. Marker fixtures never reach here; guards call these only for
// non-marker scopes.
import type { Ports } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import { checkRedProof } from "../../testing/proofs.ts";
import {
	requiredTestKinds,
	type ScenarioChange,
} from "../../testing/scenarios.ts";
import type { TaskRecord } from "../../workflow/index.ts";
import {
	collectTaskFindings,
	implementationBegan,
	isCodeTask,
} from "./scope-tasks.ts";

// SPEC §4.10.3: Codictator's own task and review records are records, not
// code; .codictator/config.json stays code (it widens to architecture).
function isCodictatorRecord(path: string): boolean {
	return (
		(path.startsWith(".codictator/tasks/") ||
			path.startsWith(".codictator/reviews/")) &&
		path.endsWith(".json")
	);
}

export function scenarioChanges(
	files: ReadonlyArray<string>,
): Array<ScenarioChange> {
	return files.map((path) => ({
		path,
		trivialOnly: false,
		isTest:
			path.includes("/tests/") ||
			path.startsWith("tests/") ||
			path.includes(".test."),
		isDoc: path.endsWith(".md") || isCodictatorRecord(path),
		isEntryPoint: false,
		addsCrossModuleImport: false,
		importsIoPackage: false,
		isNewModule: false,
		isDeletedModule: false,
		isRenamedModule: false,
	}));
}

function declaredTestsOf(task: TaskRecord): Array<{
	readonly path: string;
	readonly title: string;
}> {
	return (task.tests ?? []).map((test) => ({
		path: test.path,
		title: test.title,
	}));
}

export async function redBeforeGreenReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	return collectTaskFindings(ports, files, (task, findings) => {
		if (
			!isCodeTask(task) ||
			!implementationBegan(task) ||
			task.redProof !== undefined
		) {
			return;
		}
		const declared = declaredTestsOf(task);
		findings.push(
			...checkRedProof({
				declared:
					declared.length > 0
						? declared
						: [{ path: `(task ${task.id})`, title: "(no declared tests)" }],
				reportXml: "",
				implementationStarted: true,
				rule: "core/red-before-green",
			}),
		);
	});
}

function missingKinds(
	task: TaskRecord,
	changes: ReadonlyArray<ScenarioChange>,
	files: ReadonlyArray<string>,
): Array<{ kind: string; path: string }> {
	const required = requiredTestKinds(changes, {
		hotPaths: [],
		taskType: task.type,
		archConfigChanged: files.some((file) => file === ".codictator/config.json"),
	});
	const declaredKinds = new Set((task.tests ?? []).map((test) => test.kind));
	const path = files[0] ?? `(task ${task.id})`;
	return required
		.filter((kind) => !declaredKinds.has(kind))
		.map((kind) => ({ kind, path }));
}

export async function testKindsReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	const changes = scenarioChanges(files);
	const seen = new Set<string>();
	return collectTaskFindings(ports, files, (task, findings) => {
		if (!isCodeTask(task)) {
			return;
		}
		for (const { kind, path } of missingKinds(task, changes, files)) {
			const key = `${task.id}:${kind}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			findings.push({
				ruleId: "core/test-kinds-by-scenario",
				path,
				message: `scenario requires a ${kind} test, none declared on ${task.id}`,
				remediation: `Add the missing ${kind} test for the ${task.id} change and declare it on the task.`,
			});
		}
	});
}

export async function regressionTestReal(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	const changes = scenarioChanges(files);
	return collectTaskFindings(ports, files, (task, findings) => {
		if (task.type !== "fix" || !implementationBegan(task)) {
			return;
		}
		if ((task.tests ?? []).some((test) => test.kind === "regression")) {
			return;
		}
		const required = requiredTestKinds(changes, {
			hotPaths: [],
			taskType: task.type,
			archConfigChanged: false,
		});
		if (!required.includes("regression")) {
			return;
		}
		const path = files[0] ?? `(task ${task.id})`;
		findings.push({
			ruleId: "core/regression-test-for-fix",
			path,
			message: `fix with no regression test on ${task.id}`,
			remediation: `Add a regression test covering the ${task.id} fix and declare it with kind regression.`,
		});
	});
}
