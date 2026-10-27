// SPEC §4.1: the only module that touches the OS, network, clock or
// randomness. Every other module receives these ports by injection.
export interface CdxError {
	readonly code: string;
	readonly message: string;
	readonly detail?: string;
	readonly remediation: string;
}

export type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: CdxError };

export type Instant = string;

export interface FsStat {
	readonly isFile: boolean;
	readonly isDirectory: boolean;
	readonly size: number;
}

// SPEC §4.1.1: all paths resolve against the repo root; a write whose real
// path leaves the repo root or the OS temp dir fails with CDX-E701.
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

// SPEC §4.1.2: the only JSON.parse call in the codebase.
export function parseJson(_text: string): Result<unknown> {
	throw new Error("not implemented: SPEC §4.1.2");
}

// SPEC §4.1.2: JSON Schema 2020-12 subset; unsupported keywords are a load
// error (CDX-E201), never ignored.
export function validateSchema(_schema: string, _value: unknown): Result<void> {
	throw new Error("not implemented: SPEC §4.1.2");
}

export function sha256Hex(_bytes: Uint8Array): string {
	throw new Error("not implemented: SPEC §4.1.2");
}

// SPEC §4.1.2: first 4 characters plus length; detectors live here so other
// modules redact without importing security (§3.3).
export function redactSecrets(_text: string): string {
	throw new Error("not implemented: SPEC §4.1.2");
}

// SPEC §4.1.2: CRLF and CR become LF before hashing.
export function normalizeText(_text: string): string {
	throw new Error("not implemented: SPEC §4.1.2");
}

// SPEC §4.1.2: POSIX-separated, repo-relative; rejects .. escapes.
export function toRepoPath(_path: string): Result<string> {
	throw new Error("not implemented: SPEC §4.1.2");
}

export function globMatch(_pattern: string, _path: string): boolean {
	throw new Error("not implemented: SPEC §4.1.2");
}

// SPEC §4.1.2: sorted keys, 2-space indent, trailing newline.
export function stableStringify(_value: unknown): string {
	throw new Error("not implemented: SPEC §4.1.2");
}

export function readTomlKeys(
	_text: string,
	_keys: ReadonlyArray<string>,
): Result<Readonly<Record<string, string>>> {
	throw new Error("not implemented: SPEC §4.1.2");
}

export function readYamlKeys(
	_text: string,
	_keys: ReadonlyArray<string>,
): Result<Readonly<Record<string, string>>> {
	throw new Error("not implemented: SPEC §4.1.2");
}

export interface TestCaseResult {
	readonly id: string;
	readonly title: string;
	readonly outcome: "passed" | "failed" | "skipped";
}

export function readTestReport(_xml: string): Result<Array<TestCaseResult>> {
	throw new Error("not implemented: SPEC §4.1.2");
}
