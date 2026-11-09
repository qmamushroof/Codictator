// Slice 0 meta-guard, part 2: every L1-mapped floor rule fires on its
// consumer-shaped hook probe through the installed launcher. Red today
// (G1–G3); slice 1 greens these rows without changing what is asserted.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	denyReason,
	installConsumer,
	runLauncher,
	srcMain,
	taskId,
	toPlanning,
	writePayload,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { MATRIX, VECTOR } from "../support/consumer-matrix.ts";
import { createTempRepo } from "../support/temp-repo.ts";

function toolPayload(
	dir: string,
	tool: string,
	input: Record<string, unknown>,
	id: string,
): Record<string, unknown> {
	return {
		session_id: "sess-consumer-0",
		cwd: dir,
		hook_event_name: "PreToolUse",
		tool_name: tool,
		tool_input: input,
		tool_use_id: id,
	};
}

const HOOK_CASES: Record<string, (dir: string) => Record<string, unknown>> = {
	"write-notask": (dir) =>
		writePayload(dir, "src/mx-a.ts", "export const a = 1;\n"),
	"write-preproof": (dir) =>
		writePayload(dir, "src/mx-b.ts", "export const b = 1;\n"),
	"write-secret": (dir) =>
		writePayload(dir, "src/mx-leak.ts", `const key = "${VECTOR}";\n`),
	"write-outside": (dir) =>
		toolPayload(
			dir,
			"Write",
			{
				file_path: "/tmp/mx-outside-consumer.ts",
				content: "export const o = 1;\n",
			},
			"toolu-1",
		),
	"shell-danger": (dir) =>
		toolPayload(dir, "Bash", { command: "rm -rf /tmp/mx-probe" }, "toolu-2"),
	"read-secret": (dir) =>
		toolPayload(
			dir,
			"Read",
			{ file_path: `${dir}/src/mx-readable.ts` },
			"toolu-3",
		),
	"read-twice": (dir) =>
		toolPayload(
			dir,
			"Read",
			{ file_path: `${dir}/src/mx-readable.ts` },
			"toolu-4",
		),
	"glob-broad": (dir) =>
		toolPayload(dir, "Glob", { pattern: "src/**/*.ts" }, "toolu-5"),
	"write-history-edit": (dir) =>
		writePayload(
			dir,
			"docs/HISTORY/2026-11-08.md",
			"# History — 2026-11-08\n\n## 2026-11-08 · feat: seed\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** rewritten\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** none\n",
		),
	"write-bugs-edit": (dir) =>
		writePayload(
			dir,
			"docs/BUGS/2026.md",
			"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n| BUG-0000 | open | Edited title | 2026-11-08, none |  |  |\n",
		),
	"write-package": (dir) =>
		writePayload(
			dir,
			"package.json",
			'{"name":"mx","version":"0.0.0","dependencies":{"left-pad":"latest"}}\n',
		),
	"write-workflow": (dir) =>
		writePayload(
			dir,
			".github/workflows/probe.yml",
			"name: probe\non: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
		),
	"write-ts-phantom": (dir) =>
		writePayload(
			dir,
			"src/mx-phantom.ts",
			'import { zzz } from "./does-not-exist";\nexport const p = zzz;\n',
		),
	"write-ts-eval": (dir) =>
		// Split literal keeps the runtime probe intact without tripping the
		// repo's own text-scan gates (same idiom as the l34 secret vector).
		writePayload(
			dir,
			"src/mx-evil.ts",
			"export function run(code: string): unknown {\n  return ev" +
				"al(code);\n}\n",
		),
	"write-py-phantom": (dir) =>
		writePayload(
			dir,
			"py/mx_phantom.py",
			"import does_not_exist_xyz\nprint(does_not_exist_xyz)\n",
		),
	"write-py-eval": (dir) =>
		writePayload(dir, "py/mx_evil.py", "code = input()\nev" + "al(code)\n"),
	"write-badname": (dir) =>
		writePayload(dir, "src/Bad Name.TS", "export const b = 1;\n"),
	"write-bypass": (dir) =>
		writePayload(
			dir,
			"src/mx-bypass.ts",
			"// codictator: disable\n\nexport const b = 1;\n",
		),
	"write-narrow": (dir) =>
		writePayload(dir, "src/mx-c.ts", "export const c = 1;\n"),
	"write-fix-nodiag": (dir) =>
		writePayload(dir, "src/mx-fix.ts", "export const f = 1;\n"),
};

test("[consumer] every L1-mapped floor rule fires on its hook probe", async () => {
	const owned = (probe: string): boolean =>
		probe === "session" || HOOK_CASES[probe] !== undefined;
	const hits = new Map<string, { fired: boolean; detail: string }>();
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const rulesFor = (probe: string): Array<string> =>
			MATRIX.filter(([, entry]) => entry === probe).map(([rule]) => rule);
		const markHook = (probe: string, stdout: string): void => {
			const reason = denyReason(stdout);
			for (const rule of rulesFor(probe)) {
				hits.set(`${probe}::${rule}`, {
					fired: reason?.includes(rule) ?? false,
					detail: (reason ?? stdout).slice(0, 200),
				});
			}
		};
		const hookProbe = async (probe: string): Promise<void> => {
			const payload = HOOK_CASES[probe]?.(repo.dir);
			assert.ok(payload !== undefined, `no payload for ${probe}`);
			const result = await runLauncher(
				repo.dir,
				["hook", "muse-code", "PreToolUse"],
				JSON.stringify(payload),
			);
			markHook(probe, result.stdout);
		};
		await hookProbe("write-notask");
		const id = await taskId(repo, "matrix widget");
		await toPlanning(repo, id);
		const control = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(
				writePayload(repo.dir, "tests/mx.test.ts", 'test("mx", () => {});\n'),
			),
		);
		assert.equal(
			denyReason(control.stdout),
			undefined,
			`probe harness broken: ${control.stdout}`,
		);
		writeTreeFile(repo, "src/mx-readable.ts", "export const r = 1;\n");
		for (const probe of [
			"write-preproof",
			"write-secret",
			"write-outside",
			"shell-danger",
			"read-secret",
			"read-twice",
			"glob-broad",
			"write-ts-phantom",
			"write-ts-eval",
			"write-py-phantom",
			"write-py-eval",
			"write-badname",
			"write-bypass",
		]) {
			await hookProbe(probe);
		}
		repo.writeFile(
			"docs/HISTORY/2026-11-08.md",
			"# History — 2026-11-08\n\n## 2026-11-08 · feat: seed\n\n- **Kind:** code\n- **Task:** T-0000\n- **Why:** seed\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** none\n",
		);
		repo.git(["commit", "--no-verify", "-m", "seed history"]);
		await hookProbe("write-history-edit");
		repo.writeFile(
			"docs/BUGS/2026.md",
			"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n| BUG-0000 | open | Seed row | 2026-11-08, none |  |  |\n",
		);
		repo.git(["commit", "--no-verify", "-m", "seed bugs"]);
		await hookProbe("write-bugs-edit");
		await hookProbe("write-package");
		await hookProbe("write-workflow");
		const narrowed = await srcMain(
			["task", "amend", "--id", id, "--set-allow", "tests/**"],
			repo.dir,
		);
		assert.equal(narrowed.code, 0, `narrow failed: ${narrowed.stderr}`);
		await hookProbe("write-narrow");
		repo.git(["checkout", "-b", "fix-probe"]);
		const fixOut = await srcMain(
			["task", "new", "--type", "fix", "--title", "mx"],
			repo.dir,
		);
		assert.equal(fixOut.code, 0, `fix task failed: ${fixOut.stderr}`);
		await hookProbe("write-fix-nodiag");
		const session = await runLauncher(
			repo.dir,
			["hook", "muse-code", "SessionStart"],
			JSON.stringify({ session_id: "sess-consumer-0", cwd: repo.dir }),
		);
		for (const rule of rulesFor("session")) {
			hits.set(`session::${rule}`, {
				fired: session.stdout.includes(rule),
				detail: session.stdout.slice(0, 200),
			});
		}
		const misses: Array<string> = [];
		for (const [rule, probe, gap] of MATRIX.filter(([, entry]) =>
			owned(entry),
		)) {
			const hit = hits.get(`${probe}::${rule}`);
			if (hit === undefined) {
				misses.push(`${rule} (${probe}): no probe result recorded`);
			} else if (!hit.fired) {
				misses.push(`${rule} (${probe}, ${gap}) silent: ${hit.detail}`);
			}
		}
		assert.deepEqual(
			misses,
			[],
			`${misses.length} L1 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		repo.cleanup();
	}
});
