// SPEC §4.19.3 steps 1-6: the hook runtime. It lives in adapters (not cli/)
// because hook I/O translation is the adapter module's job (§3.3 table:
// adapters may import kernel, config, engine, steering); cli/ composes it
// with the audit append and the process sinks. Only the reply-capable
// harnesses dispatch here; universal parses fail-closed (no hook traffic)
// and every other unknown id stays CDX-E301. The loop breaker (§4.12.5)
// and steering injection (§4.6.3) run at step 5 once their phases land;
// until then the verdict decides.
import type { Clock, Env, Net, Proc, Result } from "../../kernel/index.ts";
import {
	NodeFs,
	NodeGit,
	parseJson,
	stableStringify,
} from "../../kernel/index.ts";
import type { EffectiveConfig } from "../config/index.ts";
import { HOOK_MARKER, loadConfig } from "../config/index.ts";
import type { EngineOptions } from "../engine/index.ts";
import { createEngine } from "../engine/index.ts";
import { claudeCodeAdapter } from "./claude-code.ts";
import { codexCliAdapter } from "./codex-cli.ts";
import type { Adapter, HookEvent, HookReply } from "./contract.ts";
import { HOOK_PAYLOAD_MAX_BYTES } from "./contract.ts";
import { COPILOT_TIMEOUT_SEC, copilotAdapter } from "./copilot.ts";
import { cacheKeyFor, readCacheFile, storeBytes } from "./effective-cache.ts";
import { museAdapter } from "./muse-code.ts";
import { opencodeAdapter } from "./opencode.ts";
import { universalAdapter } from "./universal.ts";

// The caller passes the root-independent ports; the runtime confines an Fs
// to the resolved repo root itself (step 2), so nothing reads the disk
// before the root is known.
export interface HookBasePorts {
	readonly proc: Proc;
	readonly net: Net;
	readonly clock: Clock;
	readonly env: Env;
}

// SPEC §4.19.3 steps 3 and 5: the verdict append carries the audit line, but
// the repo root is only known after step 2, so the append takes the root
// with the event. cli/ owns audit (§3.3) and injects this; the event type
// rides on the engine options so adapters never import audit.
export type HookAppend = (
	repoRoot: string,
	event: Parameters<NonNullable<EngineOptions["append"]>>[0],
) => Promise<Result<void>>;

export interface HookRunRequest {
	readonly harness: string;
	readonly event: string;
	readonly stdinText: string;
	readonly cwd: string;
	readonly ports: HookBasePorts;
	readonly append: HookAppend;
	readonly budgetMs?: number;
}

// SPEC §4.5.5 with §9.3: the hook time limit is min(harness timeout - 1 s,
// hard limit). Muse Code documents no hook timeout, so the 5 s hard limit
// applies; the OpenCode bridge spawns with a 5 s timeout, so 4 s here.
// Copilot entries carry timeoutSec and fail open on timeout, so the budget
// is min(timeoutSec - 1 s, hard limit), which still lands on the hard limit.
// The CLI start path bounds its stdin wait with the same budget.
export function hookBudgetMs(harness: string, override?: number): number {
	if (override !== undefined) {
		return override;
	}
	if (harness === "opencode") {
		return 4000;
	}
	if (harness === "copilot") {
		return Math.min(COPILOT_TIMEOUT_SEC * 1000 - 1000, 5000);
	}
	return 5000;
}

function adapterFor(harness: string): Adapter | undefined {
	if (harness === museAdapter.id) {
		return museAdapter;
	}
	if (harness === opencodeAdapter.id) {
		return opencodeAdapter;
	}
	if (harness === claudeCodeAdapter.id) {
		return claudeCodeAdapter;
	}
	if (harness === copilotAdapter.id) {
		return copilotAdapter;
	}
	if (harness === codexCliAdapter.id) {
		return codexCliAdapter;
	}
	if (harness === universalAdapter.id) {
		return universalAdapter;
	}
	return undefined;
}

// SPEC §4.19.3: unknown harness id blocks CDX-E301. No adapter owns the
// reply shape, so the wire is the HookDecision JSON the bridge already
// speaks (§7.8); the hook exit stays 0 so harnesses read the reply.
function unknownHarnessReply(harness: string): HookReply {
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			decision: "block",
			message: `CDX-E301 unknown harness id "${harness}"`,
			eventId: "static",
		}),
		stderr: "",
	};
}

function blockReply(
	adapter: Adapter,
	code: string,
	message: string,
): HookReply {
	return adapter.reply({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

function allowReply(adapter: Adapter, eventId: string): HookReply {
	return adapter.reply({ decision: "allow", eventId });
}

// SPEC §4.2.3 with §4.19.3: CODICTATOR_HOOK=1 is the launcher's own mark
// on the hook process, authorizing evaluation; the §4.2.3 refusal targets
// agent markers on human-only commands, not the hook reading config to
// evaluate. The runtime loads config with every marker intact except the
// launcher's own, so a foreign agent marker in the hook environment still
// refuses CDX-E107 through loadConfig.
function hookEnv(env: Env): Env {
	return {
		get: (name: string): string | undefined =>
			name === HOOK_MARKER ? undefined : env.get(name),
	};
}

// SPEC §4.19.3 step 2: the repo root from the payload cwd, else the process
// cwd, via git rev-parse. A cwd git cannot resolve is outside any Codictator
// repo, so the hook allows silently and the git-hook/CI backstops keep
// enforcing (§4.2 EC-2). The resolved root is canonicalized once via the
// kernel Fs port before config load and engine confinement: confinePath
// realpaths files before comparing against the root, so the root side must
// be canonical too — on macOS $TMPDIR lives under /var, which is a symlink
// to /private/var, and an unresolved root fails every confined access
// closed with CDX-E701. Only the kernel touches node:fs (§10.3 item 3), so
// this goes through NodeFs (whose explicit-root create already resolves via
// realpath) and reads the canonical root back with realpath(".").
// realpath is idempotent when no symlinks are present, so this is a no-op
// on Windows/Linux; a root NodeFs cannot resolve keeps the git answer, so
// unreadable roots still fail closed with CDX-E801 downstream instead of
// here.
async function canonicalRoot(root: string): Promise<string> {
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return root;
	}
	const real = await made.value.realpath(".");
	if (!real.ok) {
		return root;
	}
	return real.value;
}

async function resolveRoot(
	ports: HookBasePorts,
	startDir: string,
): Promise<string | undefined> {
	const git = new NodeGit(ports.proc, startDir);
	const root = await git.root();
	if (!root.ok) {
		return undefined;
	}
	return canonicalRoot(root.value);
}

// SPEC §4.19.3 step 3: the effective-config cache file. The keyed cache
// read lives in effective-cache.ts; the repo-relative rel paths stay here
// with the loader that reads them (§4.1.1).
const CACHE_REL = ".codictator/cache/effective.json";
const CONFIG_REL = ".codictator/config.json";
const WAIVERS_REL = ".codictator/waivers.json";
const BASELINE_REL = ".codictator/baseline.json";

async function loadEffective(
	ports: HookBasePorts,
	root: string,
	adapter: Adapter,
): Promise<
	| { readonly ok: true; value: EffectiveConfig }
	| { readonly ok: false; reply: HookReply }
> {
	const fsMade = await NodeFs.create({ root });
	if (!fsMade.ok) {
		return {
			ok: false,
			reply: blockReply(adapter, "CDX-E801", fsMade.error.message),
		};
	}
	// SPEC §4.1.1: Fs paths are repo-relative, so every call below is
	// relative (CONFIG_REL, CACHE_REL). loadConfig takes the same logical
	// root for the same reason; the Fs is already confined to root.
	const fs = fsMade.value;
	const seen = await fs.exists(CONFIG_REL);
	if (!seen.ok) {
		return {
			ok: false,
			reply: blockReply(adapter, "CDX-E801", seen.error.message),
		};
	}
	if (!seen.value) {
		return { ok: false, reply: allowReply(adapter, "no-config") };
	}
	const bytes = await fs.read(CONFIG_REL);
	if (!bytes.ok) {
		return {
			ok: false,
			reply: blockReply(adapter, "CDX-E801", bytes.error.message),
		};
	}
	const key = cacheKeyFor([
		bytes.value,
		await storeBytes(fs, WAIVERS_REL),
		await storeBytes(fs, BASELINE_REL),
	]);
	const cached = await fs.readText(CACHE_REL);
	if (cached.ok) {
		const parsed = parseJson(cached.value);
		if (parsed.ok) {
			const hit = readCacheFile(parsed.value, key);
			if (hit !== undefined) {
				return {
					ok: true,
					value: { config: hit, configHash: key },
				};
			}
		}
	}
	let effective: EffectiveConfig;
	try {
		// The Fs is already confined to root, so the logical root is "."
		// and config resolution reads repo-relative paths (§4.1.1).
		effective = await loadConfig(".", {
			fs,
			proc: ports.proc,
			net: ports.net,
			clock: ports.clock,
			git: new NodeGit(ports.proc, root),
			env: hookEnv(ports.env),
		});
	} catch (error) {
		return {
			ok: false,
			reply: blockReply(
				adapter,
				errorCodeOf(error, "CDX-E101"),
				errorMessageOf(error),
			),
		};
	}
	// Best effort: a cache write failure never blocks the hook; the
	// resolved config is authoritative and the next run re-resolves.
	const line = new TextEncoder().encode(
		stableStringify({ v: 1, key, config: effective.config }),
	);
	const written = await fs.write(CACHE_REL, line);
	if (!written.ok) {
		return { ok: true, value: effective };
	}
	return { ok: true, value: effective };
}

function errorCodeOf(error: unknown, fallback: string): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code !== ""
	) {
		return error.code;
	}
	return fallback;
}

// SPEC §9.2 with CONVENTIONS: error text never carries payload content,
// so pre-engine blocks use static strings only.
function errorMessageOf(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return "the hook runtime failed before evaluation";
}

// SPEC §4.5.4: Stop never blocks when the payload carries
// stop_hook_active, even with open findings, so the harness never loops.
function stopHookActive(
	adapter: Adapter,
	event: HookEvent,
	raw: unknown,
): boolean {
	if (adapter.id !== "muse-code" || event.event !== "Stop") {
		return false;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return false;
	}
	const stopActive =
		("stop_hook_active" in raw && raw.stop_hook_active === true) ||
		("stopHookActive" in raw && raw.stopHookActive === true);
	return stopActive;
}

function scopeFor(event: HookEvent): { readonly files: Array<string> } {
	const paths = event.tool?.paths ?? [];
	return { files: [...paths].sort() };
}

// SPEC §4.19.3: any uncaught error blocks CDX-E901; the time limit blocks
// CDX-E902. Both replies go through the adapter so the harness gates
// closed in its own deny form.
export async function runHookEvent(
	request: HookRunRequest,
): Promise<HookReply> {
	const adapter = adapterFor(request.harness);
	if (adapter === undefined) {
		return unknownHarnessReply(request.harness);
	}
	try {
		return await runHookInner(request, adapter);
	} catch {
		return blockReply(
			adapter,
			"CDX-E901",
			"the hook runtime failed before replying",
		);
	}
}

async function runHookInner(
	request: HookRunRequest,
	adapter: Adapter,
): Promise<HookReply> {
	if (
		new TextEncoder().encode(request.stdinText).length > HOOK_PAYLOAD_MAX_BYTES
	) {
		return blockReply(
			adapter,
			"CDX-E305",
			"hook payload over 8 MiB is refused; write the file in smaller edits",
		);
	}
	if (request.stdinText.trim() === "") {
		return blockReply(adapter, "CDX-E303", "hook stdin is empty");
	}
	const parsed = parseJson(request.stdinText);
	if (!parsed.ok) {
		return blockReply(adapter, "CDX-E303", "hook payload is not JSON");
	}
	const raw = parsed.value;
	const hookEvent = adapter.parse(request.event, raw);
	if (!hookEvent.ok) {
		return blockReply(adapter, hookEvent.error.code, hookEvent.error.message);
	}
	const event = hookEvent.value;
	const root = await resolveRoot(
		request.ports,
		event.cwd === "" ? request.cwd : event.cwd,
	);
	if (root === undefined) {
		return allowReply(adapter, "no-root");
	}
	if (stopHookActive(adapter, event, raw)) {
		return allowReply(adapter, "stop-active");
	}
	const effective = await loadEffective(request.ports, root, adapter);
	if (!effective.ok) {
		return effective.reply;
	}
	const engine = createEngine([], {
		configHash: effective.value.configHash,
		append: (verdict) => request.append(root, verdict),
	});
	const budgetMs = hookBudgetMs(request.harness, request.budgetMs);
	const timeoutSignal = Symbol("hook-timeout");
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const pending = engine.evaluate(
			event.trigger,
			{ files: scopeFor(event).files, sessionId: event.sessionId },
			request.ports.clock.now(),
		);
		const verdict = await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(timeoutSignal);
				}, budgetMs);
			}),
		]);
		if (verdict.decision === "block" || verdict.decision === "escalate") {
			return adapter.reply({
				decision: "block",
				message: verdict.message,
				eventId: verdict.eventId,
			});
		}
		// Muse Code has no advise form: without steering injection (phase 9)
		// an advise collapses to allow. OpenCode carries it on the wire.
		if (
			verdict.decision === "advise" &&
			verdict.message !== "" &&
			adapter.id === "opencode"
		) {
			return adapter.reply({
				decision: "advise",
				message: verdict.message,
				eventId: verdict.eventId,
			});
		}
		return adapter.reply({ decision: "allow", eventId: verdict.eventId });
	} catch (error) {
		if (error === timeoutSignal) {
			return blockReply(
				adapter,
				"CDX-E902",
				"the hook exceeded its time limit",
			);
		}
		throw error;
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

export function supportedHarness(harness: string): boolean {
	return adapterFor(harness) !== undefined;
}

// The pre-engine deny in the harness's own form (SPEC §4.5.1): staticBlock
// carries no engine state, so the launcher and the CLI start path use it
// when the engine cannot run (CDX-E002, CDX-E003).
export function staticBlock(
	harness: string,
	code: string,
	message: string,
): HookReply | undefined {
	const adapter = adapterFor(harness);
	if (adapter === undefined) {
		return undefined;
	}
	return adapter.staticBlock(code, message);
}
