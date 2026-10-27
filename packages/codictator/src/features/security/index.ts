// SPEC §4.7: secret, shell and path enforcers. The detectors themselves
// live in the kernel (§4.1.2) so redaction needs no import of this module.
import type { CheckContext, Finding } from "../engine/index.ts";

export interface SecretMatch {
	readonly kind: string;
	readonly path: string;
	readonly line: number;
	readonly redacted: string;
}

// SPEC §4.7.1: secret detection over staged content.
export function checkSecrets(
	_ctx: CheckContext,
	_content: string,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.7.1");
}

// SPEC §4.7.2: shell command analysis.
export function checkShell(
	_ctx: CheckContext,
	_command: string,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.7.2");
}

// SPEC §4.7.3: write confinement to the repo root.
export function checkPaths(
	_ctx: CheckContext,
	_paths: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.7.3");
}
