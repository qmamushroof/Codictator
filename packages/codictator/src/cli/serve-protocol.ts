// SPEC §7.15 + §4.19.5: JSON-RPC 2.0 framing for `serve --stdio`. One
// message per line, UTF-8. Frames go to stdout only; every diagnostic goes
// to stderr, so the extension parser never sees a non-frame line. Malformed
// input answers a parse error and the server keeps running (EC-9).
import { parseJson, stableLineStringify } from "../kernel/index.ts";

export const PROTOCOL_VERSION = 1;

export type RpcId = string | number | null;

export interface RpcRequest {
	readonly jsonrpc: "2.0";
	readonly id: RpcId;
	readonly method: string;
	readonly params?: unknown;
}

export interface RpcErrorShape {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, name: string): unknown {
	return record[name];
}

function isValidId(value: unknown): value is RpcId {
	return (
		typeof value === "string" || typeof value === "number" || value === null
	);
}

// SPEC §4.19.6 EC-9: a line that is not JSON is a syntax failure; parsed
// JSON that is not a JSON-RPC call is a bad request. Both keep the server
// alive; the caller maps them to -32700 and -32600.
export type DecodedLine =
	| { readonly kind: "request"; readonly request: RpcRequest }
	| {
			readonly kind: "notification";
			readonly method: string;
			readonly params: unknown;
	  }
	| { readonly kind: "syntax" }
	| { readonly kind: "bad"; readonly id: RpcId };

export function decodeLine(line: string): DecodedLine {
	const parsed = parseJson(line);
	if (!parsed.ok) {
		return { kind: "syntax" };
	}
	const value = parsed.value;
	if (!isRecord(value)) {
		return { kind: "bad", id: null };
	}
	if (recordField(value, "jsonrpc") !== "2.0") {
		return { kind: "bad", id: null };
	}
	if (typeof recordField(value, "method") !== "string") {
		return { kind: "bad", id: null };
	}
	const method = recordField(value, "method");
	if (typeof method !== "string") {
		return { kind: "bad", id: null };
	}
	const rawId = recordField(value, "id");
	if (rawId === undefined) {
		return {
			kind: "notification",
			method,
			params: recordField(value, "params"),
		};
	}
	if (!isValidId(rawId)) {
		return { kind: "bad", id: null };
	}
	return {
		kind: "request",
		request: {
			jsonrpc: "2.0",
			id: rawId,
			method,
			params: recordField(value, "params"),
		},
	};
}

export function successFrame(id: RpcId, result: unknown): string {
	return stableLineStringify({ id, jsonrpc: "2.0", result });
}

export function errorFrame(id: RpcId, error: RpcErrorShape): string {
	return stableLineStringify({ error, id, jsonrpc: "2.0" });
}

export function notificationFrame(method: string, params: unknown): string {
	return stableLineStringify({ jsonrpc: "2.0", method, params });
}

export function parseErrorFrame(): string {
	return errorFrame(null, {
		code: -32700,
		message: "Parse error: malformed JSON-RPC line",
	});
}

export function invalidRequestFrame(id: RpcId): string {
	return errorFrame(id, {
		code: -32600,
		message: "Invalid Request: expected a JSON-RPC 2.0 call",
	});
}

export function methodNotFoundError(method: string): RpcErrorShape {
	return {
		code: -32601,
		message: `Method not found: ${method}`,
	};
}

export function invalidParamsError(detail: string): RpcErrorShape {
	return {
		code: -32602,
		message: `Invalid params: ${detail}`,
	};
}

// SPEC §7.15: method failures carry their CDX row in data, so the
// extension can render the code and remediation beside the JSON-RPC error.
export function serverError(
	code: string,
	message: string,
	remediation: string,
	extra?: Record<string, unknown>,
): RpcErrorShape {
	return {
		code: -32000,
		message: `${code} ${message}`,
		data: { code, remediation, ...extra },
	};
}
