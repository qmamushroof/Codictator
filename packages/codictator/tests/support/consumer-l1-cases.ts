// Consumer-shaped L1 hook payloads for the Slice 0 firing probes, keyed by
// the MATRIX probe name. Kept apart from the run so each consumer file stays
// under the core/file-size cap.
import { writePayload } from "./consumer-harness.ts";
import { VECTOR } from "./consumer-matrix.ts";

export function toolPayload(
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

export const HOOK_CASES: Record<
	string,
	(dir: string) => Record<string, unknown>
> = {
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
		toolPayload(dir, "Read", { file_path: `${dir}/.env` }, "toolu-3"),
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
			'{"name":"mx","version":"0.0.0","dependencies":{"left-pad":"latest","axios":"1.0.0","got":"1.0.0"}}\n',
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
			'import { zzz } from "zzz-phantom-pkg";\nexport const p = zzz;\n',
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
	"write-arch-unmapped": (dir) =>
		writePayload(dir, "src/zeta/mx-z.ts", "export const z = 1;\n"),
	"write-arch-boundary": (dir) =>
		writePayload(
			dir,
			"src/alpha/mx-a.ts",
			'import { b } from "../beta/index";\nexport const a = b;\n',
		),
	"write-arch-deep": (dir) =>
		writePayload(
			dir,
			"src/alpha/mx-d.ts",
			'import { x } from "../beta/internal/x";\nexport const d = x;\n',
		),
	"write-arch-cycle": (dir) =>
		writePayload(
			dir,
			"src/alpha/mx-c.ts",
			'import { b } from "../beta/index";\nexport const c = b;\n',
		),
	"write-badname": (dir) =>
		writePayload(dir, "src/Bad Name.TS", "export const b = 1;\n"),
	"shell-bypass": (dir) =>
		toolPayload(dir, "Bash", { command: "git commit -n -m probe" }, "toolu-6"),
	"write-narrow": (dir) =>
		writePayload(dir, "src/mx-c.ts", "export const c = 1;\n"),
	"write-fix-nodiag": (dir) =>
		writePayload(dir, "src/mx-fix.ts", "export const f = 1;\n"),
};
