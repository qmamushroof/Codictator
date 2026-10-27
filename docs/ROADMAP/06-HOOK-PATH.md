# 6. Hook Path

**[◀ 5. Packs and Security](05-PACKS-SECURITY.md)** · [Roadmap index](../ROADMAP.md) · **[7. Process Guards ▶](07-PROCESS-GUARDS.md)**

| | |
|---|---|
| **Depends on** | Phase 5 |
| **Delivers** | L1 end to end for the two top-priority harnesses: a Muse Code or OpenCode tool call reaches the engine through the launcher and is allowed or blocked in the harness's own reply form |
| **Read** | SPEC §4.5.1–§4.5.5, §4.5.7, §4.19.3, §4.19.4, §7.8, §7.9, §9.3, §11 S14, S15, S29, S30; PRD §12 #30 |
| **Covers** | `§4.5 EC-1`, `§4.5 EC-2`, `§4.5 EC-9`, `§4.5 EC-11`, `§4.5 EC-13..19`, `§4.19 EC-3..6`, `§4.19 EC-8` |

Muse Code is built first, then OpenCode (PRD §9.1). Neither waits for the other P0 adapters.

## Steps

- [ ] **6.1** Adapter contract, capability declaration type, tool-name normalisation, and `staticBlock` (SPEC §4.5.1–§4.5.3). Verify: §4.5 EC-2.
- [ ] **6.2** Muse Code adapter: `parse`, `reply` (exit 0 and `hookSpecificOutput` only), `staticBlock`, capabilities with `hookIoVerified: false` and every declared gap (SPEC §4.5.4). Verify: §4.5 EC-14–16 and its golden payload tests.
- [ ] **6.3** Muse Code `render`: `.muse/hooks.json`, the memory pointer files, and the skill paths, without the `AGENTS.md` block content, which waits for steering in phase 9. Verify: render goldens.
- [ ] **6.4** OpenCode adapter: the generated plugin bridge, owned `opencode.json` keys, `parse` of the bridge payload, capabilities (SPEC §4.5.4, §11 S29). Verify: §4.5 EC-17–19 and its golden tests.
- [ ] **6.5** Launcher `.codictator/bin/run.mjs`: Node version check, engine resolution, embedded static replies, `CODICTATOR_HOOK=1` (SPEC §4.19.3). Verify: §4.5 EC-9, §4.19 EC-5, EC-6.
- [ ] **6.6** Hook runtime steps 1–6 of SPEC §4.19.3, including the payload cap, root resolution, the effective-config cache and the time limit of SPEC §4.5.5. Verify: §4.5 EC-1, EC-11, EC-13; §4.19 EC-3, EC-4, EC-8.
- [ ] **6.7** Acceptance: a real `node` process per golden payload runs launcher → engine → reply for both harnesses, allow and block, on all three OSes. Verify: acceptance tests.
- [ ] **6.8** The 200-sequential-hooks row of SPEC §10.5 meets the `tool.pre.*` budget of §9.3. Verify: `npm run test:stress`.

## Exit gate

- `npm run ledger -- --covers` with every row of **Covers** exits 0.
- Always-set and `npm run test:stress` green on all three OSes.
- The Muse Code capability declaration still states `hookIoVerified: false` unless a first-party capture is committed (SPEC §4.5.7, PRD §12 #38).
