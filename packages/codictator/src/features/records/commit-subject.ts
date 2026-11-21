// SPEC §5.11 core/conventional-commit: the commit message the commit-msg
// hook receives (SPEC §4.14.4). The subject matches the conventional form;
// a body, when present, follows one blank line. Git strips `#` comment
// lines before it records the message, so they never count as the subject
// or the body. The scope is judged by shape only: the module names a scope
// may carry live in the consumer's architecture map, which a message check
// does not read (the form's `[a-z0-9-]+` already holds `deps`, `docs`, `ci`).
// Pure over the message text (SPEC §3.3, §10.3 item 3).
import type { Finding } from "../engine/index.ts";

export const SUBJECT_PATTERN =
	/^(feat|fix|docs|refactor|test|chore|perf|ci|build|revert)(\([a-z0-9-]+\))?!?: \S.{0,71}$/;

function finding(message: string, path: string): Finding {
	return {
		ruleId: "core/conventional-commit",
		path,
		message,
		remediation:
			"Rewrite the subject as type(scope): detail, at most 72 characters after the colon, with one blank line before any body.",
	};
}

export function checkCommitMessage(message: string): Array<Finding> {
	const lines = message
		.split("\n")
		.map((line) => line.replace(/\r$/, ""))
		.filter((line) => !line.startsWith("#"));
	const first = lines.findIndex((line) => line.trim() !== "");
	if (first < 0) {
		return [];
	}
	const subject = lines[first] ?? "";
	if (!SUBJECT_PATTERN.test(subject)) {
		return [
			finding(
				`commit subject does not match the conventional form: ${subject}`,
				"COMMIT_EDITMSG",
			),
		];
	}
	const next = lines[first + 1];
	if (next !== undefined && next.trim() !== "") {
		return [
			finding(
				`commit subject must be followed by a blank line: ${subject}`,
				"COMMIT_EDITMSG",
			),
		];
	}
	return [];
}
