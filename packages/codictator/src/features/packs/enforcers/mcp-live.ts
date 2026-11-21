// SPEC §4.6.5 core/mcp-declared on the live repo: every server a
// project-level harness config declares (the file table is the kernel's) must
// be listed in config.steering.mcpAllowed. L0 judges it at session start and
// L4 on every verify range; fixture marker reports stay with the marker
// resolver.
import type { Ports, Result } from "../../../kernel/index.ts";
import {
	findUndeclaredServers,
	MCP_CONFIG_FILES,
	mcpServersIn,
	ok,
	parseJson,
} from "../../../kernel/index.ts";
import type { Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import { bindRule, findingFor, type RuleBinding } from "./binding.ts";
import type { RangeArgs } from "./range-base.ts";

const CONFIG_FILE = ".codictator/config.json";

// A file that is absent has nothing to read.
async function textOf(ports: Ports, path: string): Promise<string | undefined> {
	const seen = await ports.fs.exists(path);
	const text =
		seen.ok && seen.value ? await ports.fs.readText(path) : undefined;
	return text?.ok === true ? text.value : undefined;
}

async function allowedServers(ports: Ports): Promise<Array<string>> {
	const text = await textOf(ports, CONFIG_FILE);
	const parsed = text === undefined ? undefined : parseJson(text);
	const steering =
		parsed?.ok === true &&
		typeof parsed.value === "object" &&
		parsed.value !== null
			? (parsed.value as { steering?: { mcpAllowed?: unknown } }).steering
			: undefined;
	const listed = steering?.mcpAllowed;
	return Array.isArray(listed)
		? listed.filter((name): name is string => typeof name === "string")
		: [];
}

export async function liveMcpFindings(
	ports: Ports,
	binding: RuleBinding,
): Promise<Array<Finding>> {
	const allowed = await allowedServers(ports);
	const findings: Array<Finding> = [];
	for (const file of MCP_CONFIG_FILES) {
		const text = await textOf(ports, file);
		if (text === undefined) {
			continue;
		}
		for (const server of findUndeclaredServers(
			mcpServersIn(file, text),
			allowed,
		)) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `MCP server ${server} in ${file} is not in config.steering.mcpAllowed`,
					vars: { path: file, detail: `MCP server ${server}` },
				}),
			);
		}
	}
	return findings;
}

// SPEC §4.15.1 L4: the head tree's MCP configs.
export async function judgeMcpDeclared(args: RangeArgs): Promise<void> {
	args.findings.push(...(await liveMcpFindings(args.ports, args.binding)));
}

// L0: the live check adds the repo's findings at the session-start trigger
// only, whose hook scope carries no disk files (a self-test scope lists its
// fixture files), as withLiveStart does for the integrity rules.
export function withLiveMcp(
	base: Result<Enforcer>,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	if (!base.ok) {
		return base;
	}
	const inner = base.value;
	const binding = bindRule(rule);
	return ok({
		...inner,
		check: async (ctx, params) => {
			const own = await inner.check(ctx, params);
			if (ctx.trigger !== "startup" || ctx.scope.files.length > 0) {
				return own;
			}
			return [...own, ...(await liveMcpFindings(ports, binding))];
		},
	});
}
