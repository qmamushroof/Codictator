# 2. Red Suite

**[◀ 1. Scaffold](01-SCAFFOLD.md)** · [Roadmap index](../ROADMAP.md) · **[3. Kernel ▶](03-KERNEL.md)**

| | |
|---|---|
| **Depends on** | Phase 1 |
| **Delivers** | Every SPEC edge case and rule row as a failing test in the ledger; fixtures for every rule; module contracts; test support. The guardrails every later phase is held to |
| **Read** | SPEC §1.3, §3.3, §3.4, §7, §8, §10 in full; each module leaf while writing its tests; [CONVENTIONS.md §Tests](../CONVENTIONS.md#tests) |
| **Covers** | §10.3 item 5; the SPEC-trace completeness test |

Split by SPEC leaf: one task per §4.n leaf, plus one each for §5, §6, §8 and §10. Each task merges green with its tests listed.

## Steps

- [ ] **2.1** Contracts: every SPEC §3.3 module folder with an `index.ts` exporting the §3.4 interfaces and the §7 types it owns, plus the JSON Schema of every §7 format under `schema/`. Function bodies only throw a not-implemented error naming their SPEC section; no logic. Verify: `npm run typecheck`; §10.3 item 5 leaves the ledger.
- [ ] **2.2** Test support in `tests/support/`: fakes for the `Fs`, `Proc`, `Net`, `Clock`, `Git` and `Env` ports; a temporary git repo builder; a 127.0.0.1 HTTP server replaying recorded registry, OSV and LLM responses; a CLI runner. Verify: their own tests pass.
- [ ] **2.3** Fixture repos `ts-clean`, `ts-brownfield`, `dotnet`, `python`, `mixed` (SPEC §10.2). Verify: each builds into a temporary git repo in a test.
- [ ] **2.4** Harness payload goldens under `fixtures/harness/<harness>/<version>/`: Muse Code from the third-party evidence of SPEC §4.5.4, marked unverified; OpenCode plugin inputs; Claude Code, Copilot, Codex CLI, Cursor and Gemini CLI from vendor docs. Verify: each golden names its source and version.
- [ ] **2.5** Violating and passing fixture cases for every rule in SPEC §5 and §6, in the owning pack's `fixtures/` (SPEC §4.4.1), and the fixture-per-rule test generator. Verify: the generator emits one test per case.
- [ ] **2.6** One test per `EC-n` row of every §4.n leaf and of §6.4, titled `[§4.n EC-k] …` per SPEC §10.1. Verify: `npm test` green with all of them listed.
- [ ] **2.7** Tests for every exit code of SPEC §8.2 and for `explain` of every §8.1 code; byte-budget tests for the agent message (§4.3.7), the `AGENTS.md` block (§4.6.2) and the scoped injection (§4.6.3). Verify: listed.
- [ ] **2.8** Determinism and replay (§10.4), stress (§10.5), packaging (§10.2), and extension unit and integration tests (§10.2). Verify: listed.
- [ ] **2.9** SPEC-trace completeness test: parses the SPEC leaves, enumerates every `EC-n` row and every rule row of §5–§6, and fails if any lacks a test citing it. It is never listed. Verify: green.

## Exit gate

- VALIDATION always-set green in CI on all three OSes.
- The completeness test (2.9) passes, with every other new test listed in a ledger.
- `npm run ledger -- --covers "§10.3"` lists only the item-1 test, which leaves in phase 7.
