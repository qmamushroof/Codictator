// SPEC §7.15: stdio evaluation rows. `findings/list` and `verify` run
// the same engine evaluation the `verify` command uses; log and budget
// rows live in serve-log.ts.
import { isFixturePath } from "../kernel/index.ts";
import {
	evaluateScope,
	resolveVerifyScope,
	triggerForLayer,
} from "./evaluate.ts";
import { dispatchLogMethod } from "./serve-log.ts";
import { invalidParamsError } from "./serve-protocol.ts";
import {
	field,
	isRecord,
	type MethodContext,
	type MethodOutcome,
	methodOk,
	resolveRoot,
} from "./serve-shared.ts";
import { loadRepoConfig } from "./shared.ts";

function methodFail(
	code: string,
	message: string,
	remediation: string,
): MethodOutcome {
	return {
		ok: false,
		error: {
			code: -32000,
			message: `${code} ${message}`,
			data: { code, remediation },
		},
	};
}

function stringArrayField(
	params: unknown,
	name: string,
): Array<string> | undefined {
	if (!isRecord(params)) {
		return undefined;
	}
	const found = field(params, name);
	if (!Array.isArray(found)) {
		return undefined;
	}
	const files: Array<string> = [];
	for (const entry of found) {
		if (typeof entry !== "string") {
			return undefined;
		}
		files.push(entry);
	}
	return files;
}

// The shared scope-and-evaluate flow: files when named, else the tracked
// tree plus staged edits like the bare `verify` command; pack fixtures
// stay out of every scope (§4.4.1). Answers findings with the config hash.
async function evaluateFiles(
	ctx: MethodContext,
	files: Array<string> | undefined,
	layer: string | undefined,
): Promise<MethodOutcome> {
	const root = await resolveRoot(ctx.root);
	const configured = await loadRepoConfig(root);
	if (!configured.ok) {
		return methodFail(
			configured.error.code,
			configured.error.message,
			"Fix .codictator/config.json, then retry.",
		);
	}
	const scoped =
		files === undefined
			? await resolveVerifyScope(configured.value.ports, {
					staged: false,
					all: true,
					base: undefined,
					head: undefined,
					layer,
				})
			: {
					ok: true as const,
					value: {
						trigger: triggerForLayer(layer),
						files: [...new Set(files)]
							.sort()
							.filter((file) => !isFixturePath(file)),
						note: "stdio files",
					},
				};
	if (!scoped.ok) {
		return methodFail(
			scoped.error.code,
			scoped.error.message,
			scoped.error.remediation,
		);
	}
	const evaluated = await evaluateScope(
		configured.value.ports,
		configured.value.effective.config.packs.map((entry) => entry.id),
		scoped.value,
		configured.value.ports.clock.now(),
		configured.value.effective.configHash,
	);
	if (!evaluated.ok) {
		return methodFail(
			evaluated.error.code,
			evaluated.error.message,
			evaluated.error.remediation,
		);
	}
	return methodOk({
		findings: evaluated.value,
		configHash: configured.value.effective.configHash,
	});
}

function evaluatedParts(
	value: unknown,
): { findings: unknown; configHash: unknown } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	return {
		findings: field(value, "findings"),
		configHash: field(value, "configHash"),
	};
}

// SPEC §7.15: `findings/list { files? }` answers findings with remediation.
async function findingsListMethod(
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome> {
	const files = stringArrayField(params, "files");
	if (params !== undefined && !isRecord(params)) {
		return {
			ok: false,
			error: invalidParamsError("findings/list params must be { files? }"),
		};
	}
	if (
		isRecord(params) &&
		field(params, "files") !== undefined &&
		files === undefined
	) {
		return {
			ok: false,
			error: invalidParamsError(
				"findings/list files must be an array of strings",
			),
		};
	}
	const evaluated = await evaluateFiles(ctx, files, undefined);
	if (!evaluated.ok) {
		return evaluated;
	}
	const parts = evaluatedParts(evaluated.value);
	const findings = Array.isArray(parts?.findings) ? parts?.findings : [];
	return methodOk({
		decision: findings.length === 0 ? "allow" : "block",
		findings,
		configHash: parts?.configHash ?? "",
	});
}

const LAYERS: ReadonlySet<string> = new Set(["L1", "L2", "L3", "L4", "L5"]);

// SPEC §7.15: `verify { layer, files? }` answers a verdict for the layer.
async function verifyMethod(
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome> {
	if (!isRecord(params)) {
		return {
			ok: false,
			error: invalidParamsError("verify params must be { layer, files? }"),
		};
	}
	const layer = field(params, "layer");
	if (typeof layer !== "string" || !LAYERS.has(layer)) {
		return {
			ok: false,
			error: invalidParamsError("verify layer must be one of L1..L5"),
		};
	}
	const files = stringArrayField(params, "files");
	if (field(params, "files") !== undefined && files === undefined) {
		return {
			ok: false,
			error: invalidParamsError("verify files must be an array of strings"),
		};
	}
	const evaluated = await evaluateFiles(ctx, files, layer);
	if (!evaluated.ok) {
		return evaluated;
	}
	const parts = evaluatedParts(evaluated.value);
	const findings = Array.isArray(parts?.findings) ? parts?.findings : [];
	return methodOk({
		verdict: findings.length === 0 ? "allow" : "block",
		layer,
		findings,
		configHash: parts?.configHash ?? "",
	});
}

// SPEC §7.15 rows owned here; the log rows by serve-log.ts; unknown names
// return undefined so the caller answers method-not-found.
export async function dispatchEvalMethod(
	method: string,
	params: unknown,
	ctx: MethodContext,
): Promise<MethodOutcome | undefined> {
	switch (method) {
		case "findings/list": {
			return findingsListMethod(params, ctx);
		}
		case "verify": {
			return verifyMethod(params, ctx);
		}
		default: {
			return dispatchLogMethod(method, params, ctx);
		}
	}
}
