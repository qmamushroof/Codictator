// SPEC §4.1.2: expected failures return Result<T>. Throwing is reserved
// for programmer errors; the hook runtime turns an uncaught throw into a
// block, so a throw must never become an allow.
import type { CdxError } from "./errors.ts";

export type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: CdxError };

export function ok<T>(value: T): Result<T> {
	return { ok: true, value };
}

export function err<T>(error: CdxError): Result<T> {
	return { ok: false, error };
}
