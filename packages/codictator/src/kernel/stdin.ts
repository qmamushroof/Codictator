// SPEC §4.19.3 step 1 with §4.5.5: stdin read for the hook entry. The
// kernel owns the OS read; the byte cap and the arrival deadline arrive
// as data. A TTY stdin means no harness piped a payload, so it answers
// empty without waiting. Past the cap the payload is CDX-E305; past the
// deadline the wait is CDX-E902, so an idle pipe fails closed instead of
// hanging the hook past its time limit. A closed or unreadable stdin is
// no payload at all, and the caller maps that to its own empty-payload
// error (CDX-E303 for hooks).
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

function overCapError(maxBytes: number): Result<string> {
	return err(
		makeError(
			"CDX-E305",
			`hook payload over ${maxBytes} bytes is refused`,
			"Write the file in smaller edits, then retry the tool call.",
		),
	);
}

function pastDeadlineError(): Result<string> {
	return err(
		makeError(
			"CDX-E902",
			"hook input did not arrive within the hook time limit",
			"Retry the tool call; if the harness stalls its hook input, report the stall.",
		),
	);
}

export function readStdinText(
	maxBytes: number,
	deadlineMs: number,
): Promise<Result<string>> {
	if (process.stdin.isTTY === true) {
		return Promise.resolve(ok(""));
	}
	return new Promise((resolve) => {
		const chunks: Array<Buffer> = [];
		let total = 0;
		let settled = false;
		const finish = (result: Result<string>): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			process.stdin.removeListener("data", onData);
			process.stdin.removeListener("end", onEnd);
			process.stdin.removeListener("error", onError);
			process.stdin.pause();
			resolve(result);
		};
		const onData = (chunk: Buffer): void => {
			total += chunk.length;
			if (total > maxBytes) {
				finish(overCapError(maxBytes));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = (): void => {
			finish(ok(Buffer.concat(chunks).toString("utf8")));
		};
		const onError = (): void => {
			finish(ok(""));
		};
		const timer = setTimeout(() => {
			finish(pastDeadlineError());
		}, deadlineMs);
		process.stdin.on("data", onData);
		process.stdin.on("end", onEnd);
		process.stdin.on("error", onError);
		process.stdin.resume();
	});
}
