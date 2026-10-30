// SPEC §4.15.1 + §4.14.4: kernel-owned reads and writes of absolute host
// paths. The confined Fs port (§4.1.1) cannot reach files outside the repo
// and the OS temp dir, like the CI event payload (GITHUB_EVENT_PATH) or the
// COMMIT_EDITMSG file git hands the commit-msg hook (absolute, and outside
// the worktree root in a linked worktree); this keeps that OS access in the
// kernel (§3.3). Callers pass only git- or CI-owned paths, never agent input.
import { promises as fsp } from "node:fs";
import path from "node:path";
import {
	encodingError,
	ioError,
	outsideError,
	readFailure,
} from "./fs-errors.ts";
import { err, ok, type Result } from "./result.ts";

// Relative paths fail CDX-E701; unwritable paths fail CDX-E903, so
// callers degrade the same way as Fs.write.
export async function writeHostText(
	absolutePath: string,
	content: string,
): Promise<Result<void>> {
	if (!path.isAbsolute(absolutePath)) {
		return err(outsideError());
	}
	try {
		await fsp.writeFile(absolutePath, content, "utf8");
		return ok(undefined);
	} catch (cause) {
		return err(ioError("write", absolutePath, cause));
	}
}

// Relative paths fail CDX-E701; missing, unreadable or non-UTF-8 files
// fail CDX-E903 like Fs.readText, so callers degrade the same way.
export async function readHostText(
	absolutePath: string,
): Promise<Result<string>> {
	if (!path.isAbsolute(absolutePath)) {
		return err(outsideError());
	}
	const loaded = await fsp.readFile(absolutePath).then(
		(data) => ok(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
		(cause: unknown) => readFailure(absolutePath, cause),
	);
	if (!loaded.ok) {
		return err(loaded.error);
	}
	const bytes = loaded.value;
	const body =
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
			? bytes.subarray(3)
			: bytes;
	try {
		return ok(new TextDecoder("utf-8", { fatal: true }).decode(body));
	} catch {
		return err(encodingError(absolutePath));
	}
}
