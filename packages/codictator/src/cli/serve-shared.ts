// SPEC §7.15: shared stdio plumbing. Method results, unknown narrowing
// and root resolution for the read, evaluation and run rows; framing stays
// in serve-protocol.ts. Imports kernel only, so every serve module builds
// on this without cycles.
import { resolveRepoRoot } from "../kernel/index.ts";
import type { RpcErrorShape } from "./serve-protocol.ts";

export interface MethodContext {
	readonly root: string;
}

export type MethodOutcome =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: RpcErrorShape };

export function methodOk(value: unknown): MethodOutcome {
	return { ok: true, value };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// satisfied without tripping useLiteralKeys (kernel schema.ts pattern).
export function field(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

// Injectable stdio ends for tests (SPEC §4.19.6 EC-10): production passes
// the process triple, so two servers can share one process in tests the
// way two VS Code windows share one repo.
export interface StdioServerStdin {
	readonly readable: boolean;
	readonly readableEnded: boolean;
	readonly isTTY?: boolean | undefined;
	on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
	on(event: "end" | "error", listener: () => void): unknown;
	removeListener(
		event: "data" | "end" | "error",
		listener: (...args: Array<never>) => void,
	): unknown;
	resume(): unknown;
	pause(): unknown;
}

export interface StdioServerStdout {
	write(chunk: string | Uint8Array): boolean;
}

export interface StdioServerStreams {
	readonly stdin: StdioServerStdin;
	readonly stdout: StdioServerStdout;
	readonly stderr: StdioServerStdout;
}

export async function resolveRoot(cwd: string): Promise<string> {
	const root = await resolveRepoRoot(cwd);
	return root.ok ? root.value : cwd;
}
