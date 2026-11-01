// SPEC §10.5: the shared 10,000-file reference repo (10,000 files, 2,000
// source files) the stress rows measure against per SPEC §9.3, plus the
// p95 helper the latency rows assert with (SPEC §9.3 budgets are p95) and
// a log reader for the no-lost-event row. Raw writes keep the build fast:
// no per-file git process, one commit at most.
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface ReferenceRepo {
	readonly dir: string;
	git(args: ReadonlyArray<string>): string;
	cleanup(): void;
}

export interface ReferenceRepoOptions {
	readonly gitInit?: boolean;
	readonly config?: boolean;
	readonly commitBase?: boolean;
}

const STRESS_CONFIG = JSON.stringify({
	version: 1,
	codictator: "0.0.0",
	packs: [],
	harnesses: ["muse-code", "opencode"],
});

// SPEC §9.3: budgets are p95. Same index convention as buildReportText so
// the harness and the product agree on which sample the budget binds.
export function p95Ms(samples: ReadonlyArray<number>): number {
	const sorted = [...samples].sort((left, right) => left - right);
	if (sorted.length === 0) {
		return 0;
	}
	const at = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
	return sorted[at] ?? 0;
}

export function buildReferenceRepo(
	options: ReferenceRepoOptions = {},
): ReferenceRepo {
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-stress-"));
	const git = (args: ReadonlyArray<string>): string =>
		execFileSync("git", [...args], {
			cwd: dir,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
	if (options.gitInit === true) {
		try {
			git(["init", "-b", "main"]);
		} catch {
			git(["init"]);
		}
		git(["config", "user.email", "codictator-test@example.com"]);
		git(["config", "user.name", "codictator-test"]);
		git(["config", "commit.gpgsign", "false"]);
	}
	mkdirSync(path.join(dir, "src"), { recursive: true });
	mkdirSync(path.join(dir, "data"), { recursive: true });
	for (let index = 0; index < 2000; index += 1) {
		writeFileSync(
			path.join(dir, "src", `mod-${index}.ts`),
			`export const v${index} = ${index};\n`,
		);
	}
	for (let index = 0; index < 8000; index += 1) {
		writeFileSync(
			path.join(dir, "data", `blob-${index}.txt`),
			`filler ${index}\n`,
		);
	}
	if (options.config === true) {
		mkdirSync(path.join(dir, ".codictator"), { recursive: true });
		writeFileSync(path.join(dir, ".codictator", "config.json"), STRESS_CONFIG);
	}
	if (options.commitBase === true) {
		git(["add", "-A"]);
		git(["commit", "--quiet", "-m", "reference repo base (SPEC section 9.3)"]);
	}
	return {
		dir,
		git,
		cleanup: (): void => {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

// A missing log is zero lines; every returned line is asserted intact by
// the caller, so a lost or interleaved append fails the row, not the read.
export function readLogLines(dir: string): Array<string> {
	let text: string;
	try {
		text = readFileSync(
			path.join(dir, ".codictator", "state", "events.jsonl"),
			"utf8",
		);
	} catch {
		return [];
	}
	return text.split("\n").filter((line) => line !== "");
}
