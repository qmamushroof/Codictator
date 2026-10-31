// SPEC §4.5.6: custom adapter loading from .codictator/adapters/<id>/.
// The loader resolves the adapter module, validates its Adapter shape and
// assembles the Adapter seam (CDX-E301 when nothing is installed, CDX-E302
// while it has no passing contract tests), so every use stays inert until
// it verifies. File reads go through the kernel Fs (confined to the repo
// root); the module itself executes via a dynamic import, the generated
// launcher's own pattern for loading code.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CdxError, Result } from "../../kernel/index.ts";
import { err, makeError, NodeFs, ok } from "../../kernel/index.ts";
import type {
	Adapter,
	CapabilityDeclaration,
	FileArtifact,
	HookDecision,
	HookReply,
	RenderInput,
} from "./contract.ts";
import { narrowEvent } from "./custom-event.ts";
import {
	ADAPTER_BASE,
	ADAPTER_ENTRY,
	failParse,
	field,
	fullIdOf,
	isRecord,
	type ModuleFn,
	narrowAdapterCapabilities,
	narrowAdapterHead,
	noContract,
	unknownId,
} from "./custom-shape.ts";

// SPEC §4.5.6: the id is one path segment, so no adapter escapes its own
// directory. Anything else is an unknown id (CDX-E301), never a read.
function isSafeId(id: string): boolean {
	if (id === "" || id === "." || id === "..") {
		return false;
	}
	return (
		!id.includes("/") &&
		!id.includes("\\") &&
		!id.includes("\0") &&
		!id.includes("..")
	);
}

// SPEC §4.5.6: load the custom adapter <id> from <root>. A missing adapter
// file is CDX-E301; a module that fails to import or to match the Adapter
// shape is CDX-E302, so every use stays inert until it verifies.
export async function loadCustomAdapter(
	root: string,
	id: string,
): Promise<Result<Adapter>> {
	const fullId = fullIdOf(id);
	if (!isSafeId(id)) {
		return err(unknownId(fullId));
	}
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return err(made.error);
	}
	const seen = await made.value.exists(
		`${ADAPTER_BASE}/${id}/${ADAPTER_ENTRY}`,
	);
	if (!seen.ok) {
		return err(seen.error);
	}
	if (!seen.value) {
		return err(unknownId(fullId));
	}
	let exported: unknown;
	try {
		const loaded: unknown = await import(
			pathToFileURL(path.join(root, ADAPTER_BASE, id, ADAPTER_ENTRY)).href
		);
		exported = loaded;
	} catch {
		return err(noContract(fullId, "the adapter module failed to import"));
	}
	return narrowAdapter(exported, fullId);
}

function narrowAdapterError(value: unknown): CdxError {
	if (isRecord(value)) {
		const code = field(value, "code");
		const message = field(value, "message");
		const remediation = field(value, "remediation");
		if (
			typeof code === "string" &&
			code !== "" &&
			typeof message === "string" &&
			message !== "" &&
			typeof remediation === "string" &&
			remediation !== ""
		) {
			return makeError(code, message, remediation);
		}
	}
	return failParse("the adapter returned a malformed error");
}

function wrapParse(fullId: string, parse: unknown): Adapter["parse"] {
	// SPEC §4.5.1: adapters are pure sync functions, so the module boundary
	// call below is sync; a throw becomes CDX-E303, never a forged event.
	const call = parse as ModuleFn;
	return (event: string, raw: unknown) => {
		let outcome: unknown;
		try {
			outcome = call(event, raw);
		} catch {
			return err(failParse("the adapter threw while parsing"));
		}
		if (!isRecord(outcome)) {
			return err(failParse("expected a result object"));
		}
		if (field(outcome, "ok") === true) {
			return narrowEvent(fullId, field(outcome, "value"));
		}
		if (field(outcome, "ok") === false) {
			return err(narrowAdapterError(field(outcome, "error")));
		}
		return err(failParse("expected a result object"));
	};
}

function narrowReplyOutcome(fullId: string, outcome: unknown): HookReply {
	if (!isRecord(outcome)) {
		throw new Error(`custom adapter "${fullId}" returned a malformed reply`);
	}
	const exitCode = field(outcome, "exitCode");
	const stdout = field(outcome, "stdout");
	const stderr = field(outcome, "stderr");
	if (
		typeof exitCode !== "number" ||
		!Number.isInteger(exitCode) ||
		typeof stdout !== "string" ||
		typeof stderr !== "string"
	) {
		throw new Error(`custom adapter "${fullId}" returned a malformed reply`);
	}
	return { exitCode, stdout, stderr };
}

function wrapReply(fullId: string, reply: unknown): Adapter["reply"] {
	const call = reply as ModuleFn;
	// A malformed reply throws (a programmer error in the adapter); the
	// hook runtime turns the throw into a CDX-E901 block, so a broken
	// adapter never becomes an allow.
	return (decision: HookDecision) => narrowReplyOutcome(fullId, call(decision));
}

function wrapRender(fullId: string, render: unknown): Adapter["render"] {
	const call = render as ModuleFn;
	return (input: RenderInput) => {
		const outcome = call(input);
		if (!Array.isArray(outcome)) {
			throw new Error(
				`custom adapter "${fullId}" returned malformed artifacts`,
			);
		}
		const artifacts: Array<FileArtifact> = [];
		for (const entry of outcome) {
			if (!isRecord(entry)) {
				throw new Error(
					`custom adapter "${fullId}" returned malformed artifacts`,
				);
			}
			const artifactPath = field(entry, "path");
			const content = field(entry, "content");
			if (
				typeof artifactPath !== "string" ||
				artifactPath === "" ||
				typeof content !== "string"
			) {
				throw new Error(
					`custom adapter "${fullId}" returned malformed artifacts`,
				);
			}
			artifacts.push({ path: artifactPath, content });
		}
		return artifacts;
	};
}

function wrapStaticBlock(
	fullId: string,
	reply: Adapter["reply"],
	staticBlock: unknown,
): Adapter["staticBlock"] {
	if (typeof staticBlock === "function") {
		const call = staticBlock as ModuleFn;
		return (code: string, message: string) =>
			narrowReplyOutcome(fullId, call(code, message));
	}
	// SPEC §4.5.1: the static deny carries the pre-engine deny form.
	return (code: string, message: string) =>
		reply({
			decision: "block",
			message: `${code} ${message}`,
			eventId: "static",
		});
}

function narrowAdapter(module: unknown, fullId: string): Result<Adapter> {
	const head = narrowAdapterHead(module, fullId);
	if (!head.ok) {
		return err(head.error);
	}
	const capabilities = narrowAdapterCapabilities(fullId, head.value.candidate);
	if (!capabilities.ok) {
		return err(capabilities.error);
	}
	const replyFn = wrapReply(fullId, head.value.reply);
	return ok({
		id: fullId,
		// The loader validated identity, callables, layers and gaps above,
		// so only the capability record crosses the untyped boundary here
		// (via unknown: Record<string, unknown> shows no overlap to the
		// compiler, but the checked shape is the declaration). Gap, kept
		// deliberately narrow: adapterVersion, verifiedAgainst and controls
		// cross unvalidated — nothing reads them yet (§7.9), so the gap is
		// inert until anything reads controls, at which point those fields
		// must be validated here.
		capabilities: capabilities.value as unknown as CapabilityDeclaration,
		render: wrapRender(fullId, head.value.render),
		parse: wrapParse(fullId, head.value.parse),
		reply: replyFn,
		staticBlock: wrapStaticBlock(
			fullId,
			replyFn,
			field(head.value.candidate, "staticBlock"),
		),
	});
}
