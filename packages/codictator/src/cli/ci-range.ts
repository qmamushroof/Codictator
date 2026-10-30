// SPEC §4.15.1 + §4.7.1: the ci verify change scope. The range comes from
// --base/--head (the §4.15.6 external-CI form) else GITHUB_EVENT_PATH;
// the enforcers judge the range's files plus its commit messages. Split
// from ci.ts by responsibility (core/file-size): this file owns the
// scope, ci.ts owns the verdict.
import { parseArgs } from "node:util";
import type { CdxError, Result } from "../kernel/index.ts";
import { err, ok, parseJson, readHostText } from "../kernel/index.ts";
import type { CommandPorts } from "./shared.ts";
import { loadRepoConfig } from "./shared.ts";

export interface CiVerifyFlags {
	readonly base: string | undefined;
	readonly head: string | undefined;
}

export interface CiRange {
	readonly base: string;
	readonly head: string;
}

// SPEC §4.19.2: `ci verify` takes no positionals; the range is an
// optional --base/--head pair (the §4.15.6 external-CI form). Anything
// else is a usage error.
export function parseCiVerifyFlags(
	args: ReadonlyArray<string>,
): CiVerifyFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {
				base: { type: "string" },
				head: { type: "string" },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if (
			(parsed.values.base === undefined) !==
			(parsed.values.head === undefined)
		) {
			return undefined;
		}
		return { base: parsed.values.base, head: parsed.values.head };
	} catch {
		return undefined;
	}
}

export async function ciPackIds(root: string): Promise<ReadonlyArray<string>> {
	const configured = await loadRepoConfig(root);
	if (!configured.ok) {
		return [];
	}
	return configured.value.effective.config.packs.map((entry) => entry.id);
}

async function runCiGit(
	ports: CommandPorts,
	argv: ReadonlyArray<string>,
): Promise<string | undefined> {
	const ran = await ports.proc.run(argv, {
		cwd: ports.root,
		env: {},
		timeoutMs: 30000,
		maxOutputBytes: 8 * 1024 * 1024,
	});
	if (ran.timedOut || ran.truncated || ran.code !== 0) {
		return undefined;
	}
	return ran.stdout;
}

// SPEC §4.15.1: the range comes from --base/--head (the §4.15.6
// external-CI form), else GITHUB_EVENT_PATH (PR base and head SHAs, or
// `before`/`after` for pushes). Without either there is no change to
// judge: L4 runs the repo-wide rules only (§4.3.2). The event file is read
// kernel-owned — it lives outside the repo, past the confined Fs port —
// and a set but unreadable event path fails closed instead of silently
// skipping the change scope.
export async function resolveCiRange(
	ports: CommandPorts,
	flags: CiVerifyFlags,
): Promise<Result<CiRange | undefined>> {
	if (flags.base !== undefined && flags.head !== undefined) {
		return ok({ base: flags.base, head: flags.head });
	}
	const eventPath = ports.env.get("GITHUB_EVENT_PATH");
	if (eventPath === undefined || eventPath === "") {
		return ok(undefined);
	}
	const text = await readHostText(eventPath);
	if (!text.ok) {
		return err(text.error);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return err({
			code: "CDX-E303",
			message:
				"CI event payload is unparseable, so the verify range is unknown",
			remediation:
				"Re-run with --base <sha> --head <sha> for the change under review.",
		} satisfies CdxError);
	}
	const body = parsed.value as {
		readonly pull_request?: {
			readonly base?: { readonly sha?: unknown };
			readonly head?: { readonly sha?: unknown };
		};
		readonly before?: unknown;
		readonly after?: unknown;
	};
	const prBase = body.pull_request?.base?.sha;
	const prHead = body.pull_request?.head?.sha;
	const after = body.after;
	const base =
		typeof prBase === "string" && prBase !== "" ? prBase : body.before;
	// SPEC §4.15.7 EC-1: pull-request events carry no top-level `after`;
	// the head rides on pull_request.head.sha instead. A push carries
	// `after`, which wins when present.
	let head: string | undefined;
	if (typeof after === "string" && after !== "") {
		head = after;
	} else if (typeof prHead === "string" && prHead !== "") {
		head = prHead;
	}
	if (typeof base !== "string" || base === "" || head === undefined) {
		return err({
			code: "CDX-E303",
			message: "CI event payload names no verify range",
			remediation:
				"Re-run with --base <sha> --head <sha> for the change under review.",
		} satisfies CdxError);
	}
	// SPEC §4.15.7 EC-3: push of a new branch (no `before`) — the base is
	// the merge-base with the default branch.
	if (/^0+$/.test(base)) {
		return mergeBaseFallback(ports, head);
	}
	return ok({ base, head });
}

async function mergeBaseFallback(
	ports: CommandPorts,
	head: string,
): Promise<Result<CiRange | undefined>> {
	const symref = await runCiGit(ports, [
		"git",
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
	]);
	const branch = symref?.trim().split("/").pop();
	if (branch === undefined || branch === "") {
		return ok(undefined);
	}
	const merged = await runCiGit(ports, [
		"git",
		"merge-base",
		"HEAD",
		`origin/${branch}`,
	]);
	if (merged === undefined || merged.trim() === "") {
		return ok(undefined);
	}
	return ok({ base: merged.trim(), head });
}

// SPEC §4.7.1: L4 covers every commit message in range, so the range's full
// bodies ride as proposed content. An unreadable log degrades to the file
// scope instead of failing the run.
export async function rangeMessages(
	ports: CommandPorts,
	base: string,
	head: string,
): Promise<string> {
	const bodies = await runCiGit(ports, [
		"git",
		"log",
		"--format=%B",
		`${base}..${head}`,
	]);
	return bodies ?? "";
}
