// SPEC §8: the Fs port's error vocabulary. Expected I/O failures are Results
// carrying real error codes, never throws: CDX-E701 for confinement, CDX-E903
// for missing or unreadable data. Messages name the repo-relative path (never
// file content) so they are safe for logs and events (§9.2).
import { type CdxError, makeError } from "./errors.ts";
import { err, type Result } from "./result.ts";

export function outsideError(): CdxError {
	return makeError(
		"CDX-E701",
		"path escapes the repo root",
		"Keep the path inside the repo root or the OS temp dir.",
	);
}

export function notFoundError(rel: string): CdxError {
	return makeError(
		"CDX-E903",
		`no file at ${rel}`,
		"Create the file first or check the path spelling.",
	);
}

export function encodingError(rel: string): CdxError {
	return makeError(
		"CDX-E903",
		`file at ${rel} is binary-or-unknown-encoding`,
		"Read the file with read (bytes) instead of readText.",
	);
}

export function ioError(op: string, rel: string, cause: unknown): CdxError {
	const reason = cause instanceof Error ? cause.message : "unknown failure";
	return makeError(
		"CDX-E903",
		`cannot ${op} ${rel}: ${reason}`,
		"Check permissions and disk space, then retry.",
	);
}

function errorCode(cause: unknown): string | undefined {
	if (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		typeof cause.code === "string"
	) {
		return cause.code;
	}
	return undefined;
}

export function mapReadError(rel: string, cause: unknown): CdxError {
	if (errorCode(cause) === "ENOENT") {
		return notFoundError(rel);
	}
	return ioError("read", rel, cause);
}

export function readFailure(rel: string, cause: unknown): Result<never> {
	return err(mapReadError(rel, cause));
}
