// Shared scenario for the L3 live-judging unit files (SPEC §4.12.3 L3): a
// resolver run over a staged file set read from a fake worktree, with an
// optional HEAD base for the rules that judge an addition.
import type { Enforcer, Finding } from "../../src/features/engine/index.ts";
import type { EnforcerDecl } from "../../src/features/packs/manifest.ts";
import type { PackRule, Ports, Result } from "../../src/kernel/index.ts";
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
	for (const [name, text] of Object.entries(run.head ?? {})) {
		fakes.git.setShow("HEAD", name, text);
	}
	const enforcer = checked(resolver(DECL, ruleFor(ruleId), fakes.ports));
	return enforcer.check(
		{
			trigger: "review",
			scope: { files: run.staged },
			now: FIXED_INSTANT,
			configHash: "test-hash",
		},
		{},
	);
}

export function ids(found: ReadonlyArray<Finding>): Array<string> {
	return found.map((finding) => finding.ruleId);
}
