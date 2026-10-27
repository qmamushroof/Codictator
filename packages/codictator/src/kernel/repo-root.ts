// SPEC §4.1.1: repo-root resolution for the Fs port. Walks up from a start
// directory to the nearest ancestor holding a `.git` entry and returns its
// canonical (symlink-resolved) path. Anything else is CDX-E703, never a guess.
import { promises as fsp } from "node:fs";
import path from "node:path";
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

export async function pathExists(target: string): Promise<boolean> {
	try {
		await fsp.access(target);
		return true;
	} catch {
		return false;
	}
}

export async function resolveRepoRoot(
	startDir: string,
): Promise<Result<string>> {
	let dir = path.resolve(startDir);
	while (true) {
		if (await pathExists(path.join(dir, ".git"))) {
			return ok(await fsp.realpath(dir));
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return err(
				makeError(
					"CDX-E703",
					`no git repository above ${startDir}`,
					"Run inside a git repository so paths resolve against its root.",
				),
			);
		}
		dir = parent;
	}
}
