// SPEC §4.1.2: POSIX-separated, repo-relative, case preserved. A path with
// .. that normalises inside the repo is allowed and the normalised path is
// used (EC-2); one that escapes the root fails with CDX-E701 (EC-1).
import { type CdxError, makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

function escapeError(): CdxError {
	return makeError(
		"CDX-E701",
		"path escapes the repo root",
		"Keep the path inside the repo root; remove leading .. segments.",
	);
}

export function toRepoPath(path: string): Result<string> {
	if (path === "") {
		return err(escapeError());
	}
	const slashed = path.replace(/\\/g, "/");
	if (slashed.startsWith("/") || /^[A-Za-z]:(\/|$)/.test(slashed)) {
		return err(escapeError());
	}
	const kept: Array<string> = [];
	for (const part of slashed.split("/")) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			const previous = kept.pop();
			if (previous === undefined) {
				return err(escapeError());
			}
			continue;
		}
		kept.push(part);
	}
	if (kept.length === 0) {
		return ok(".");
	}
	return ok(kept.join("/"));
}

// SPEC §4.7.3: writes into .git/ are blocked except through git itself.
// The input is a repo-relative normalised path as toRepoPath returns it.
export function isGitDirPath(rel: string): boolean {
	return rel === ".git" || rel.startsWith(".git/");
}
