// SPEC §4.1: the only module that touches the operating system, the network
// or the clock (§3.3). Everything else receives ports by injection, which
// makes every other module testable without I/O.

import type { Instant } from "./contracts.ts";
import type { Result } from "./result.ts";

export { SystemClock } from "./clock.ts";
export { readTomlKeys, readYamlKeys } from "./config-keys.ts";
export type {
	CheckContext,
	Decision,
	Enforcer,
	Finding,
	Instant,
	Pack,
	PackManifest,
	PackRule,
	PackRuleParam,
	Scope,
	Trigger,
} from "./contracts.ts";
export { TRIGGERS } from "./contracts.ts";
export { isEntryModule } from "./entry.ts";
export { NodeEnv } from "./env.ts";
export type { CdxError } from "./errors.ts";
export { makeError } from "./errors.ts";
export type { NodeFsOptions } from "./fs.ts";
export { NodeFs } from "./fs.ts";
export type { ConfinedPath } from "./fs-confine.ts";
export { Confiner, confinePath } from "./fs-confine.ts";
export {
	encodingError,
	ioError,
	notFoundError,
	outsideError,
	readFailure,
} from "./fs-errors.ts";
export { NodeGit } from "./git.ts";
export { globMatch } from "./glob.ts";
export { normalizeText, sha256Hex, sha256Text } from "./hash.ts";
export { readHostText, writeHostText } from "./host.ts";
export { parseJson, stableLineStringify, stableStringify } from "./json.ts";
export type { NodeNetOptions } from "./net.ts";
export {
	NET_ALLOWLIST,
	NET_MAX_BODY_BYTES,
	NET_MAX_REDIRECTS,
	NodeNet,
	netHostAllowed,
	rejectNetUrl,
} from "./net.ts";
export { isGitDirPath, toRepoPath } from "./path.ts";
export { checkPattern } from "./pattern.ts";
export { buildProcEnv, NodeProc, PROC_ENV_ALLOWLIST } from "./proc.ts";
export type { LossyText } from "./read-cache.ts";
export { cachedLossyText } from "./read-cache.ts";
export { redactSecrets } from "./redact.ts";
export { pathExists, resolveRepoRoot } from "./repo-root.ts";
export type { Result } from "./result.ts";
export { err, ok } from "./result.ts";
export { validateSchema } from "./schema.ts";
export {
	DEFAULT_FIXTURE_GLOBS,
	isFixturePath,
	isSecretReadPath,
} from "./secret-paths.ts";
export type { ShellAnalysis, ShellPipeline, SimpleCommand } from "./shell.ts";
export type { ShellViolation, ShellViolationClass } from "./shell-deny.ts";
export { matchDangerousShell } from "./shell-deny.ts";
export { analyseShell } from "./shell-scan.ts";
export { readStdinText } from "./stdin.ts";
export type { TestCaseResult } from "./test-report.ts";
export { readTestReport } from "./test-report.ts";

export interface FsStat {
	readonly isFile: boolean;
	readonly isDirectory: boolean;
	readonly size: number;
}

// SPEC §4.1.1: all paths resolve against the repo root; a write whose real
// path (after symlink resolution) leaves the repo root or the OS temp dir
// fails with CDX-E701. Writes are atomic (temp file + rename). Text is read
// as UTF-8; a BOM is stripped and reported to the caller.
export interface Fs {
	readonly read: (path: string) => Promise<Result<Uint8Array>>;
	readonly readText: (path: string) => Promise<Result<string>>;
	readonly write: (path: string, content: Uint8Array) => Promise<Result<void>>;
	readonly append: (path: string, content: Uint8Array) => Promise<Result<void>>;
	readonly stat: (path: string) => Promise<Result<FsStat>>;
	readonly list: (dir: string) => Promise<Result<Array<string>>>;
	readonly glob: (
		pattern: string,
		dir: string,
	) => Promise<Result<Array<string>>>;
	readonly exists: (path: string) => Promise<Result<boolean>>;
	readonly realpath: (path: string) => Promise<Result<string>>;
	readonly remove: (path: string) => Promise<Result<void>>;
}

export interface ProcResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
	readonly truncated: boolean;
}

export interface ProcOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly stdin?: string;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
}

// SPEC §4.1.1: shell: false always; argv array only; kills the process tree
// on timeout.
export interface Proc {
	readonly run: (
		argv: ReadonlyArray<string>,
		options: ProcOptions,
	) => Promise<ProcResult>;
}

export interface NetRequest {
	readonly method: string;
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly timeoutMs: number;
}

export interface NetResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

// SPEC §4.1.1: host must be allowlisted (§9.2); HTTPS only; 32 MiB cap.
export interface Net {
	readonly request: (req: NetRequest) => Promise<Result<NetResponse>>;
}

// SPEC §4.1.1: injected; tests and replay pass a fixed instant.
export interface Clock {
	readonly now: () => Instant;
}

// SPEC §4.1.1: implemented over Proc running git; never mutates history.
export interface Git {
	readonly root: () => Promise<Result<string>>;
	readonly head: () => Promise<Result<string>>;
	readonly stagedFiles: () => Promise<Result<Array<string>>>;
	readonly diff: (base: string, head: string) => Promise<Result<string>>;
	readonly show: (rev: string, path: string) => Promise<Result<string>>;
	readonly config: (key: string) => Promise<Result<string>>;
	readonly log: (range: string) => Promise<Result<string>>;
	readonly isClean: () => Promise<Result<boolean>>;
}

// SPEC §4.1.1: read-only view for harness variables and API-key lookup.
export interface Env {
	readonly get: (name: string) => string | undefined;
}

export interface Ports {
	readonly fs: Fs;
	readonly proc: Proc;
	readonly net: Net;
	readonly clock: Clock;
	readonly git: Git;
	readonly env: Env;
}
