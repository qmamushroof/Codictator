// SPEC §4.4.3 step 4: the enforcer registry wiring. Kinds owned by later
// modules resolve deferred and fail closed; parametric (§4.4.6) and
// config-bound external (§4.4.5) enforcers resolve now, one instance per
// referencing rule so findings carry the rule id the self-test asserts.
import type { Ports, Result } from "../../kernel/index.ts";
import {
	err,
	makeError,
	NodeEnv,
	NodeFs,
	NodeGit,
	NodeNet,
	NodeProc,
	ok,
	SystemClock,
} from "../../kernel/index.ts";
import type { Enforcer } from "../engine/index.ts";
import type { ExternalOptions, ToolDecl } from "./enforcers/external.ts";
import { resolveExternal } from "./enforcers/external-check.ts";
import { isParametricKind, resolveParametric } from "./enforcers/parametric.ts";
import type { PackManifest, PackRule } from "./index.ts";
import type { EnforcerDecl } from "./manifest.ts";

export interface RegistryOptions {
	readonly onToolEvent?: ExternalOptions["onToolEvent"];
}

// SPEC §4.4.3 step 4: a deferred stub throws CDX-E901 when run — violating
// fixtures cannot pass on it, and the engine turns the throw into a block
// (§4.3.8). Kinds owned by later modules, orphan decls no rule references,
// unbound parametric decls and external bindings with no config.tools row
// all defer here.
function deferredEnforcer(decl: EnforcerDecl, note?: string): Enforcer {
	const owner =
		decl.kind === "code"
			? `module ${decl.module ?? "unassigned"}`
			: `kind ${decl.kind}`;
	const until = note ?? "until its owning module lands";
	return {
		id: decl.id,
		kinds: [],
		budgetMs: decl.budgetMs,
		check: (): Promise<never> => {
			throw makeError(
				"CDX-E901",
				`enforcer "${decl.id}" (${owner}) is deferred ${until}`,
				"Implement the enforcer in its owning module, then re-run the pack self-test.",
			);
		},
	};
}

function wiredKind(kind: string): boolean {
	return kind === "external" || isParametricKind(kind);
}

function missingToolEnforcer(decl: EnforcerDecl): Enforcer {
	return {
		id: decl.id,
		kinds: [],
		budgetMs: decl.budgetMs,
		check: (): Promise<never> => {
			throw makeError(
				"CDX-E901",
				`enforcer "${decl.id}" needs config.tools id "${decl.tool ?? "unknown"}" bound before it resolves`,
				"Declare the tool in config.tools, then reload the pack.",
			);
		},
	};
}

// SPEC §4.4.5: production callers inject repo-rooted ports; without them the
// registry falls back to a drive-rooted live bundle mirroring the loader's
// own read path, so builtin self-checks behave like the loader's reads.
export async function livePorts(root: string): Promise<Result<Ports>> {
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return err(made.error);
	}
	const proc = new NodeProc();
	return ok({
		fs: made.value,
		proc,
		net: new NodeNet(),
		clock: new SystemClock(),
		git: new NodeGit(proc, "."),
		env: new NodeEnv(),
	});
}

export function resolvePackEnforcers(
	manifest: PackManifest,
	decls: ReadonlyArray<EnforcerDecl>,
	ports: Ports,
	tools: ReadonlyArray<ToolDecl>,
	options: RegistryOptions = {},
): Result<Array<Enforcer>> {
	const byDecl = new Map<string, Array<PackRule>>();
	for (const rule of manifest.rules) {
		const bound = byDecl.get(rule.enforcer);
		if (bound === undefined) {
			byDecl.set(rule.enforcer, [rule]);
		} else {
			bound.push(rule);
		}
	}
	const resolved: Array<Enforcer> = [];
	for (const decl of decls) {
		const rules = (byDecl.get(decl.id) ?? []).sort((a, b) =>
			a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
		);
		if (rules.length === 0 || !wiredKind(decl.kind)) {
			resolved.push(deferredEnforcer(decl));
			continue;
		}
		for (const rule of rules) {
			if (isParametricKind(decl.kind)) {
				const made = resolveParametric(decl, rule, ports);
				if (!made.ok) {
					return err(made.error);
				}
				if (made.value === undefined) {
					resolved.push(
						deferredEnforcer(decl, "until its §4.4.6 args bind it"),
					);
					continue;
				}
				resolved.push(made.value);
			} else {
				const tool = tools.find((entry) => entry.id === decl.tool);
				if (tool === undefined) {
					resolved.push(missingToolEnforcer(decl));
					continue;
				}
				const externalOptions =
					options.onToolEvent === undefined
						? {}
						: { onToolEvent: options.onToolEvent };
				const made = resolveExternal(decl, rule, ports, tool, externalOptions);
				if (!made.ok) {
					return err(made.error);
				}
				resolved.push(made.value);
			}
		}
	}
	resolved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return ok(resolved);
}
