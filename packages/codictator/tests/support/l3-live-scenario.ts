// Shared scenario for the L3 live-judging unit files (SPEC §4.12.3 L3): a
// resolver run over a staged file set read from a fake worktree, with an
// optional HEAD base for the rules that judge an addition, or an L4 range
// base for the range judges.
import type { Enforcer, Finding } from "../../src/features/engine/index.ts";
import { resolveCodeEnforcer } from "../../src/features/packs/enforcers/code.ts";
import type { EnforcerDecl } from "../../src/features/packs/manifest.ts";
import type { PackRule, Ports, Result } from "../../src/kernel/index.ts";
import { ok } from "../../src/kernel/index.ts";
import { FIXED_INSTANT } from "./fake-clock.ts";
import { createFakePorts } from "./fake-ports.ts";
import { checked, ruleFor } from "./pre-tool-scenario.ts";

type Resolver = (
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) => Result<Enforcer>;

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

export interface LiveRun {
	readonly worktree: Readonly<Record<string, string>>;
	readonly staged: ReadonlyArray<string>;
	readonly head?: Readonly<Record<string, string>>;
	// SPEC §4.10.4: the L4 range base texts; set, the scope carries base
	// `BASE` the way ci verify threads the range base.
	readonly base?: Readonly<Record<string, string>>;
	readonly now?: string;
}

export async function runLive(
	resolver: Resolver,
	ruleId: string,
	run: LiveRun,
): Promise<Array<Finding>> {
	const fakes = createFakePorts();
	for (const [name, text] of Object.entries(run.worktree)) {
		fakes.fs.seedText(name, text);
	}
	for (const [rev, texts] of [
		["HEAD", run.head],
		["BASE", run.base],
	] as const) {
		for (const [name, text] of Object.entries(texts ?? {})) {
			fakes.git.setShow(rev, name, text);
		}
	}
	const enforcer = checked(resolver(DECL, ruleFor(ruleId), fakes.ports));
	return enforcer.check(
		{
			trigger: "review",
			scope: {
				files: run.staged,
				...(run.base === undefined ? {} : { base: "BASE" }),
			},
			now: run.now ?? FIXED_INSTANT,
			configHash: "test-hash",
		},
		{},
	);
}

export function ids(found: ReadonlyArray<Finding>): Array<string> {
	return found.map((finding) => finding.ruleId);
}

// The registry resolver: the code enforcer with its L4 range judge
// attached, exactly as a pack load builds it.
function registryResolver(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const resolved = resolveCodeEnforcer(decl, rule, ports);
	if (!resolved.ok || resolved.value === undefined) {
		throw new Error(`no code enforcer for ${rule.id}`);
	}
	return ok(resolved.value);
}

// SPEC §4.10.4: one rule over an L4 range, every head file changed. With
// no base texts the scope carries no base, as on the L1–L3 legs.
export function runRange(
	ruleId: string,
	base: Readonly<Record<string, string>> | undefined,
	head: Readonly<Record<string, string>>,
	now?: string,
): Promise<Array<Finding>> {
	return runLive(registryResolver, ruleId, {
		worktree: head,
		staged: Object.keys(head),
		...(base === undefined ? {} : { base }),
		...(now === undefined ? {} : { now }),
	});
}
