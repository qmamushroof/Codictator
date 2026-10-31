// SPEC §4.5.6: shared custom-adapter shape validation. Dependency leaf
// (kernel and contract only): layout constants, adapter identity, the
// CDX-E301/E302 error constructors, the record-narrowing primitives and
// the module/capability shape checks. The payload narrowing
// (custom-event.ts) and the loader (custom-load.ts) build on this file,
// so neither direction grows a cycle.
import type { CdxError, Result } from "../../kernel/index.ts";
import { err, makeError, ok } from "../../kernel/index.ts";

export const ADAPTER_BASE = ".codictator/adapters";
export const ADAPTER_ENTRY = "adapter.mjs";
export const CUSTOM_PREFIX = "custom:";

export type ModuleFn = (...args: Array<unknown>) => unknown;

export function fullIdOf(id: string): string {
	return `${CUSTOM_PREFIX}${id}`;
}

export function unknownId(fullId: string): CdxError {
	return makeError(
		"CDX-E301",
		`unknown harness id "${fullId}"`,
		`Install the adapter at ${ADAPTER_BASE}/<id>/${ADAPTER_ENTRY}, then retry.`,
	);
}

export function noContract(fullId: string, detail: string): CdxError {
	return makeError(
		"CDX-E302",
		`custom adapter "${fullId}" has no passing contract tests`,
		`Ship golden payload fixtures beside the adapter, fix ${ADAPTER_BASE}/<id>/${ADAPTER_ENTRY}, then run codictator adapter test ${fullId}.`,
		detail,
	);
}

export function failParse(detail: string): CdxError {
	return makeError(
		"CDX-E303",
		`unparseable custom hook payload: ${detail}`,
		"Check the harness hook configuration, then retry the tool call.",
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function field(record: Record<string, unknown>, key: string): unknown {
	return record[key];
}

export interface AdapterHead {
	readonly candidate: Record<string, unknown>;
	readonly parse: unknown;
	readonly reply: unknown;
	readonly render: unknown;
}

// SPEC §4.5.6: the module must export an adapter object whose id equals
// its harness id and whose parse/reply/render are all functions.
export function narrowAdapterHead(
	module: unknown,
	fullId: string,
): Result<AdapterHead> {
	if (!isRecord(module)) {
		return err(noContract(fullId, "the module must export an adapter object"));
	}
	const candidate = field(module, "adapter");
	if (!isRecord(candidate)) {
		return err(noContract(fullId, "the module must export an adapter object"));
	}
	if (field(candidate, "id") !== fullId) {
		return err(noContract(fullId, "adapter id must equal its harness id"));
	}
	const parse = field(candidate, "parse");
	const reply = field(candidate, "reply");
	const render = field(candidate, "render");
	if (
		typeof parse !== "function" ||
		typeof reply !== "function" ||
		typeof render !== "function"
	) {
		return err(
			noContract(fullId, "the adapter must define parse, reply and render"),
		);
	}
	return ok({ candidate, parse, reply, render });
}

// SPEC §4.5.6: every capability layer is native, partial or none.
export function narrowCapabilityLayers(
	fullId: string,
	layers: unknown,
): Result<Record<string, unknown>> {
	if (!isRecord(layers)) {
		return err(noContract(fullId, "capabilities must declare layers"));
	}
	for (const key of ["L0", "L1", "L2", "L3", "L4", "L5"]) {
		const level = field(layers, key);
		if (level !== "native" && level !== "partial" && level !== "none") {
			return err(
				noContract(fullId, "capability layers must be native, partial or none"),
			);
		}
	}
	return ok(layers);
}

export function checkCapabilityGaps(
	fullId: string,
	gaps: unknown,
): Result<undefined> {
	if (!Array.isArray(gaps)) {
		return err(noContract(fullId, "capabilities must declare gaps"));
	}
	for (const entry of gaps) {
		if (typeof entry !== "string") {
			return err(noContract(fullId, "capabilities must declare gaps"));
		}
	}
	return ok(undefined);
}

export function narrowAdapterCapabilities(
	fullId: string,
	candidate: Record<string, unknown>,
): Result<Record<string, unknown>> {
	const capabilities = field(candidate, "capabilities");
	if (!isRecord(capabilities)) {
		return err(noContract(fullId, "the adapter must declare capabilities"));
	}
	if (field(capabilities, "harness") !== fullId) {
		return err(noContract(fullId, "capabilities must name the custom harness"));
	}
	const layers = narrowCapabilityLayers(fullId, field(capabilities, "layers"));
	if (!layers.ok) {
		return err(layers.error);
	}
	const gaps = checkCapabilityGaps(fullId, field(capabilities, "gaps"));
	if (!gaps.ok) {
		return err(gaps.error);
	}
	return ok(capabilities);
}
