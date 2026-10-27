# 4.5 adapters

**[◀ 4.4 packs](04-04-PACKS.md)** · [SPEC index](../SPEC.md) · **[4.6 steering ▶](04-06-STEERING.md)**

Renders the effective rule set into each harness's native files and translates each harness's hook traffic to and from the normalised hook contract (§7.8). Priority and release split: PRD §9.1, §12 #21, #30. Harness facts below were checked against vendor docs on 2026-10-26; anything not documented is marked **unverified** and the adapter treats it as a gap until a captured payload proves it (§4.5.7, PRD §12 #18).

## 4.5.1 Contract

`Adapter` (§3.4): `render(input) → FileArtifact[]` (whole files or owned entries in shared files), `parse(event, raw) → HookEvent`, `reply(decision) → HookReply` (`{ exitCode, stdout, stderr }`). Adapters are pure: no I/O, so every adapter is tested against golden files and golden payloads.

Every generated hook command runs the launcher (§4.19.3): `node <root>/.codictator/bin/run.mjs hook <harness> <event>`. `<root>` is the harness's documented project-root source (`projectRootSource`, §7.9); where none is documented, the path is relative and the launcher resolves the root from the payload `cwd` (§4.19.3 step 2).

**Static block replies.** Each adapter exposes `staticBlock(code, message) → HookReply` with no engine state. `regen` embeds, per configured harness, the static replies for `CDX-E002` and `CDX-E003` into the launcher, so an old Node or a missing engine blocks in each harness's own native deny form (§4.19.3).

**Owned entries.** In a shared file (`.claude/settings.json`, `.gemini/settings.json`, `.codex/config.toml`, `opencode.json`), Codictator owns only entries whose command contains `.codictator/bin/run.mjs` and the keys listed per harness. User entries are preserved; the manifest hashes the canonical projection of owned entries (§4.14.1).

## 4.5.2 Capability declaration

Each adapter ships `capabilities` (schema §7.9): per layer `native | partial | none`, and per control — `contextFile`, `contextInject`, `postCompactInject`, `promptBlock`, `preToolBlock`, `readBlock`, `postToolFeedback`, `autoCompactConfig`, `forceCompact`, `forceClear`, `usageData`, `skills`, `subagents`, `commands`, `projectPermissions`, `trustRequired`, `timeoutFailMode`, `launcherMissingFailMode`, `hookIoVerified`, `agentEnvMarkers` — plus `verifiedAgainst` (harness version, date, source URL). `status`, `explain` and the extension show gaps verbatim; a gap is covered by L3/L4 and never claimed as enforced.

**Post-tool events never gate.** A `tool.post.*` finding is returned as feedback where `postToolFeedback` is native, and its rule blocks at L3/L4; the write has already landed, so no adapter claims a post-tool block as prevention.

## 4.5.3 Event mapping

| Normalised (§7.8) | Muse Code | OpenCode | Claude Code | Codex CLI | Copilot | Cursor (P1) | Gemini CLI (P1) |
|---|---|---|---|---|---|---|---|
| `session.start` | `SessionStart` (`source` values unverified) | `session.created` event (observe only) | `SessionStart` | `SessionStart` | `sessionStart` | `sessionStart` | `SessionStart` |
| `prompt.submit` | `UserPromptSubmit` | `chat.message`; context delivered by `experimental.chat.system.transform` | `UserPromptSubmit` | `UserPromptSubmit` | `userPromptSubmitted` | `beforeSubmitPrompt` | `BeforeAgent` |
| `tool.pre.*` | `PreToolUse` | `tool.execute.before` | `PreToolUse` | `PreToolUse` | `preToolUse` | `preToolUse`, `beforeShellExecution`, `beforeReadFile`, `beforeMCPExecution` | `BeforeTool` |
| `tool.post.write` | `PostToolUse` (feedback only) | `tool.execute.after` | `PostToolUse` | `PostToolUse` | `postToolUse` | `afterFileEdit` | `AfterTool` |
| `compact.post` | `PostCompact` | `experimental.session.compacting` (adds to the compaction prompt) | `SessionStart` source `compact` | unverified | — | — | unverified |
| `subagent.start` | `SubagentStart` | — | `SubagentStart` | — | — | unverified | — |
| `stop` | `Stop` | `session.idle` event (observe only) | `Stop` | `Stop` | — | `stop` | `AfterAgent` |
| usage for budgets | `PostLLMCall` payload (unverified) | `message.updated` token fields (unverified) | transcript usage lines | unverified | — | — | unverified |

The normaliser maps tool names to `kind` (`write`, `shell`, `read`, `search`, `web`, `mcp`, `task`, `other`) through a per-adapter table; an unknown tool name maps to `other` and is evaluated by `tool.pre.other` rules, so a new harness tool is still seen.

## 4.5.4 Harness adapters

### Muse Code — P0, first, best-supported (PRD §12 #30)

| Aspect | Specification |
|---|---|
| Files | `AGENTS.md` (shared, §4.6.2) · `.muse/hooks.json` (events in §4.5.3; Claude-shaped `{ "hooks": { "<Event>": [{ "matcher": "*", "hooks": [{ "type": "command", "command" }] }] } }`, shape unverified) · `.agents/skills/codictator-<id>/SKILL.md` (§4.6.6) · `.agents/memory/MEMORY.md` + `.agents/memory/codictator.md` |
| Why memory | Committed project memory loads even in an untrusted workspace, while `AGENTS.md`, skills and hooks load only after trust; the memory topic carries the precedence statement and the pointer to `AGENTS.md`, so L0 exists before trust |
| Context | `AGENTS.md` nearest-wins per directory, walking up to the `.git` boundary; Codictator writes only the root file unless `config.steering.scopedContextFiles` lists sub-dirs |
| Hook I/O evidence | Vendor docs list events but not payloads or replies. Third-party live probes (Muse Code 1.4.7 and 1.4.10; agentchute PR #235, toolu issue #540) observed: Claude-shaped snake_case stdin (`session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `transcript_path`); `PreToolUse` honours exit 0 + `hookSpecificOutput.permissionDecision: "deny"`; a bare `allow` is rejected; legacy top-level shapes (`decision`, top-level `permissionDecision`) are hook errors and the tool runs; `SessionStart` and `UserPromptSubmit` inject `hookSpecificOutput.additionalContext`; exit-2 deny unconfirmed; reports disagree on `updatedInput` and `PostToolUse` blocking |
| Reply | Block: exit 0, stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":<message>}}`. Allow: exit 0, stdout `{}`. Inject: exit 0, `hookSpecificOutput.additionalContext`. Never used: exit 2, `updatedInput`, `PostToolUse`/`PostToolBatch` blocking, any legacy shape. `Stop` never blocks when the payload has `stop_hook_active: true`. Git hooks and CI are the backstop for everything L1 misses |
| Environment | Hooks run outside the sandbox with a cleared environment and a PATH-resolved command; the launcher relies on nothing but `node` on PATH and the payload `cwd`. `model` from hook input is recorded in events |
| Protection | Muse's sandbox keeps `.git`, `.muse` and `.agents` read-only for the agent; `.codictator/`, `.githooks/` and CI files rely on L1 (§4.14.3) |
| Trust | Project hooks run only after the folder is trusted: L1 shows `unknown` until a `session.start` event from Muse Code is recorded for this repo, then `active` |
| Budget | `transcript_path` is null under `muse exec`; no documented usage field or force-compact/clear command: `usageData: none`, `forceCompact: false`, `forceClear: false`. The hard band blocks tool calls and prompts until the checkpoint is committed and the user runs `/clear` or `/new` (§4.6.4) |
| Fail modes | `timeoutFailMode`, `launcherMissingFailMode`: unknown (no hook timeout field documented); with Node missing the hook cannot start, so L3/L4 block |
| Gaps declared | `hookIoVerified: false` until a first-party capture passes (§4.5.7); subagent definition files (managed via `/subagents`, no documented file); project-level permissions (settings are user-level); hook timeout field; post-tool feedback |

### OpenCode — P0 (PRD §12 #21; Codictator's own dogfooding harness with Meta models)

| Aspect | Specification |
|---|---|
| Files | `.opencode/plugins/codictator.mjs` (generated bridge, plain ESM, imports only `node:child_process` and `node:crypto`) · `opencode.json` owned keys: `compaction.auto: true`, `permission.bash` deny patterns for bypass commands (§4.14.3) · `AGENTS.md` (native) · `.opencode/agents/codictator-<id>.md` · `.opencode/commands/codictator-<id>.md` |
| Bridge | Exports one plugin function. `tool.execute.before` and `tool.execute.after` serialise `{ event, tool: input.tool, sessionID, callID, args: output.args, cwd: directory }` to the launcher's stdin with `spawnSync("node", [launcher, "hook", "opencode", event])`, no shell (timeout = §9.3 hard limit); a reply with `decision: "block"`, a non-zero exit, a spawn error or a timeout throws `Error(message)`, which OpenCode turns into a refused tool call. `experimental.session.compacting` pushes the launcher's `additionalContext` onto `output.context`. Per-prompt injection below. `shell.env` sets `CODICTATOR_AGENT=opencode` in agent shells (an agent marker, §4.2.3). `event` forwards `session.created`, `session.compacted`, `session.idle` and `message.updated` for recording |
| Per-prompt injection | `chat.message` (fires once per user message, before it is stored) spawns `prompt.submit` and caches the returned `additionalContext` in bridge memory per `sessionID`. `experimental.chat.system.transform` (fires before **every** model call of the agent loop, subagent sessions included) appends the cached text to `output.system`; nothing is persisted, so it costs no history and survives compaction. A cache miss there (plugin restart, resumed session) spawns `prompt.submit` once for that session. **Probe and fallback:** if `tool.execute.before` fires in a turn whose context the transform never delivered, the bridge records the gap and, from the next prompt, pushes the context as a `synthetic: true` text part onto `chat.message`'s `output.parts` instead, re-sent only when its hash changes (§4.6.3) |
| Context file | `AGENTS.md` native; OpenCode re-reads it and every `opencode.json` `instructions` entry from disk before each model call, so `regen` takes effect mid-session; an unreadable file is silently dropped, which the L3/L4 drift check covers. Codictator adds no `instructions` entry (it would duplicate `AGENTS.md`) |
| Hook source | `@opencode-ai/plugin` `Hooks` type (`packages/plugin/src/index.ts`: `chat.message` L234, `tool.execute.before` L266, `experimental.chat.system.transform` L291); call sites `packages/opencode/src/session/prompt.ts` L999 (`chat.message`), L1260 (instructions re-read per step), `session/llm/request.ts` L68 (system transform), all at tag `v1.19.4`. The plugins page documents only the `tool.*`, `shell.env`, `event` and compaction hooks; `chat.message` is stable-named but undocumented, the transform is `experimental` |
| Version range | Supported `>=1.15.0 <2.0.0` (§11 S32): the hooks above exist in the type definitions across that range. `verifiedAgainst` is 1.19.4, npm `latest` on 2026-10-26. `status` compares `opencode --version`; outside the range, L1 and `contextInject` show `unknown`. 2.x reshapes the plugin API and stays a declared gap until a 2.x release has been npm `latest` for at least 7 days and a first-party capture passes; a new engine version then widens the range |
| Reply | The bridge and launcher are both generated, so the wire is Codictator's own JSON (`HookDecision`, §7.8) on stdout, exit 0; `hookIoVerified` covers only the plugin-API inputs, verified by capture |
| Fail modes | OpenCode awaits hooks in sequence and a thrown error aborts the hook's caller (`packages/opencode/src/plugin/index.ts` L294). Tool gating fails closed by construction: every `tool.execute.*` bridge error throws. `launcherMissingFailMode: closed`. Injection hooks never throw: a launcher error injects the static line "Codictator context unavailable (<code>); `AGENTS.md` and tool gating still apply" and records the event, so a steering fault never kills a turn. The hard band is the one deliberate throw in `chat.message`, which aborts the prompt before it is stored (`promptBlock: partial`, source-verified, not yet captured) |
| Budget | `usageData` from `message.updated` token fields (unverified); `autoCompactConfig: partial` (on/off and `reserved` tokens, no percentage threshold); `forceCompact`, `forceClear`: false |
| Trust | No project-trust step documented: L1 is `active` once the plugin file is present |
| Gaps declared | `contextInject: partial` (experimental transform; synthetic-part fallback) and `promptBlock: partial` until a first-party capture; `session.*` events are observe-only; skills directory unverified; OpenCode 2.x |

**Meta Model API provider for OpenCode.** When `init` selects OpenCode and `opencode.json` has no `provider.meta`, it prints the block below from Meta's coding-agent guide. It never writes it, because the model choice is the user's. The user then runs `/connect` → `meta`, which stores `MODEL_API_KEY` outside the repo:

```json
{ "provider": { "meta": {
    "npm": "@ai-sdk/openai", "name": "Meta Model API",
    "options": { "baseURL": "https://api.meta.ai/v1" },
    "models": { "muse-spark-1.3": { "reasoning": true, "limit": { "context": 1048576, "output": 131072 },
      "options": { "reasoningEffort": "high", "reasoningSummary": "auto", "include": ["reasoning.encrypted_content"] } } } } } }
```

An inline `options.apiKey` value is a `core/no-secrets` finding; `{env:MODEL_API_KEY}` is allowed.

### Universal — P0

`AGENTS.md`; git hooks `pre-commit`, `commit-msg`, `pre-push` (§4.14.4); CI workflow (§4.15). Covers every harness with no native adapter (PRD §7.3). L1: `none`.

### Claude Code — P0

| Aspect | Specification |
|---|---|
| Files | `.claude/settings.json` owned keys: `hooks` entries, `permissions.deny` entries (bypass commands and secret paths from §4.7, §4.14.3), `disableBypassPermissionsMode: "disable"` · `CLAUDE.md` containing only `@AGENTS.md` · `.claude/skills/codictator-<id>/SKILL.md` · `.claude/agents/codictator-<id>.md` · `.claude/commands/codictator-<id>.md` |
| Root | `$CLAUDE_PROJECT_DIR` |
| Reply | Pre-tool block: exit 2 + stderr (cannot be overridden by JSON allow). Inject: exit 0 + `hookSpecificOutput.additionalContext`. Post-tool feedback and `Stop` continuation: JSON `decision: "block"` + `reason` |
| Budget | `usageData: transcript` — context = last main-chain assistant turn's input + cache-read + cache-creation tokens from `transcript_path`; subagents measured on their own transcript |
| Agent marker | `CLAUDECODE=1` in agent shells |

### GitHub Copilot — P0 (CLI, cloud agent, VS Code agent)

| Aspect | Specification |
|---|---|
| Files | `.github/hooks/codictator.json` (`version: 1`; entries `type: "command"`, `bash` and `powershell` both set to the launcher command, `cwd: "."`, `timeoutSec`) · `.github/copilot-instructions.md` (one line: follow `AGENTS.md`) · `.github/agents/codictator-<id>.agent.md` · `.github/prompts/codictator-<id>.prompt.md` |
| Reply | stdout `{"permissionDecision":"deny","permissionDecisionReason":…}` plus exit 2 |
| Fail mode | Non-zero exits fail closed for `preToolUse`, but **timeouts fail open**: the hook self-terminates with a deny 1 s before `timeoutSec` (§4.5.5). `disableAllHooks: true` in any hooks file is a tamper finding (§4.14) |

### Codex CLI — P0

| Aspect | Specification |
|---|---|
| Files | `.codex/hooks.json` (Claude-shaped: event → `[{ matcher, hooks: [{ type: "command", command, timeout }] }]`) · `.codex/config.toml` owned key `[features] hooks = true` · `AGENTS.md` (native) · skills in `.agents/skills/` (unverified for Codex) |
| Reply | Same as Claude Code (exit 2 + stderr; JSON `permissionDecision`) |
| Gaps declared | Project hooks need the project trusted; project `.codex/hooks.json` is ignored inside git worktrees (openai/codex #27133) — `status` reports it when the repo root is a worktree |

### Cursor, Gemini CLI — P1

| Harness | Files | Reply | Declared gaps |
|---|---|---|---|
| Cursor | `.cursor/hooks.json` (`version: 1`, `failClosed: true` on every permission hook) · `AGENTS.md` (native) | `{"permission":"deny","agentMessage":…,"userMessage":…}` | Cursor CLI emits only shell events; no usage data |
| Gemini CLI | `.gemini/settings.json` owned keys `hooks` and `context.fileName: ["AGENTS.md"]` | `{"decision":"deny","reason":…}` or exit 2 | Trusted-folder requirement; compaction events unverified |

## 4.5.5 Time limits

Each adapter declares its harness's hook timeout. The hook runtime sets its own time limit to `min(harness timeout − 1 s, §9.3 hard limit)` and, on reaching it, replies **block** with `CDX-E902`, so a slow check never turns into a harness-side fail-open. Where no timeout is documented (Muse Code), the §9.3 hard limit applies.

## 4.5.6 Custom adapters

`config.harnesses` may name `custom:<id>`, loading `.codictator/adapters/<id>/adapter.mjs` that exports an `Adapter`. It must ship golden payload fixtures and pass the same contract tests (§10.3) via `codictator adapter test <id>`; until then it is inert (`CDX-E302`).

## 4.5.7 Verification and churn

`codictator adapter capture <harness>` records the raw stdin of each hook event into `.codictator/state/captures/` during a real session. Codictator's own repo commits sanitised captures as golden fixtures under `packages/codictator/fixtures/harness/<harness>/<version>/`; a parse failure on a capture fails CI. `hookIoVerified` becomes `true` only with a committed first-party capture for the declared version; third-party reports shape the initial goldens but never set it. On any parse failure at runtime, the hook replies block with `CDX-E303` and the event records the unknown shape (PRD §11.4).

## 4.5.8 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Harness sends a payload missing `tool_name` | `CDX-E303`, block, raw shape logged (redacted) |
| EC-2 | Unknown tool name | `kind: other`; `tool.pre.other` rules run |
| EC-3 | User added their own hook entry in `.claude/settings.json` | Preserved on regenerate; not in manifest projection |
| EC-4 | User deleted Codictator's `PreToolUse` entry | Drift finding at next session start, L3 and L4 (§4.14) |
| EC-5 | Copilot hook near `timeoutSec` | Deny emitted before the timeout |
| EC-6 | `disableAllHooks: true` added to a Copilot hooks file | Tamper finding, blocks at L3/L4 |
| EC-7 | Muse Code workspace not yet trusted | L1 `unknown`; memory topic still steers; L3/L4 enforce |
| EC-8 | Codex run inside a git worktree | `status` shows L1 inactive for Codex with the issue reference |
| EC-9 | Engine not installed (repo cloned without `npm ci`) | Launcher writes the harness's embedded static block reply for `CDX-E003` (Muse Code: exit 0 deny JSON; Claude Code: exit 2) |
| EC-10 | Two harnesses configured; same rule blocks in both | Identical message text from both (one engine) |
| EC-11 | Hook payload larger than 8 MiB (huge `Write`) | Block `CDX-E305`; remediation: write the file in smaller edits |
| EC-12 | Regeneration with no config change | Byte-identical files |
| EC-13 | Harness runs hook from a sub-directory | Launcher resolves repo root via `git rev-parse` before evaluating |
| EC-14 | Muse Code allow decision | stdout exactly `{}`, exit 0; golden test asserts no `permissionDecision: "allow"` |
| EC-15 | Muse Code block decision | Exit 0 with the `hookSpecificOutput` deny JSON; golden test asserts exit code 0 and no top-level `decision` key |
| EC-16 | Muse Code `Stop` with `stop_hook_active: true` | Allow (`{}`), even with open findings, so the harness never loops |
| EC-17 | OpenCode bridge: launcher exceeds the spawn timeout | Bridge throws; tool call refused; event `CDX-E902` recorded on the next run |
| EC-18 | OpenCode bridge: `node` not on PATH | Spawn error → throw → tool refused with `CDX-E001` text |
| EC-19 | `opencode.json` contains `options.apiKey` with a literal value | `core/no-secrets` blocks at L1, L3, L4 |
| EC-20 | OpenCode version without `experimental.chat.system.transform` | Probe trips at the first tool call; context moves to a synthetic `chat.message` part from the next prompt; `status` shows the fallback |
| EC-21 | OpenCode bridge: launcher fails during `chat.message` or the transform | Static fallback line injected, turn proceeds, event recorded; tool calls still gated |
| EC-22 | OpenCode session resumed after restart (no `chat.message` yet) | Transform cache miss spawns `prompt.submit` once; context present on the first model call |
| EC-23 | OpenCode prompt at the hard band | `chat.message` throws the checkpoint message; prompt not stored; tool calls blocked as §4.6.4 |
| EC-24 | `opencode --version` reports 2.x | `status` shows OpenCode L1 `unknown` with the supported range; `init` warns; L3 and L4 enforce as usual |
