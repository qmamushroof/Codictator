# 11. Extension

**[◀ 10. Self-Host](10-SELF-HOST.md)** · [Roadmap index](../ROADMAP.md) · **[12. P1 Scope ▶](12-P1-SCOPE.md)**

| | |
|---|---|
| **Depends on** | Phase 10 (may run in parallel with phase 12) |
| **Delivers** | The stdio server and the VS Code extension with the P0 views: Active rules, Violations, Timeline; L2 on save |
| **Read** | SPEC §4.19.5, §4.20, §7.15, §11 S6, S28; PRD §12 #2, #22 |
| **Covers** | `§4.20`, `§4.19 EC-9`, `§4.19 EC-10`, `§4.20 EC-11`, `§4.20 EC-12`, `§7.15` |

## Steps

- [x] **11.1** `serve --stdio`: JSON-RPC methods of SPEC §7.15, `events/appended` notifications, the human-only answer for `run`. Verify: §4.19 EC-9, EC-10.
- [x] **11.2** Extension shape: the CommonJS shim and ESM main, activation, the trust requirement, one server per workspace folder, version handshake, setup welcome for repos without Codictator (SPEC §4.20.1). Verify: §4.20 EC-9; unit tests with the fake `vscode` API.
- [x] **11.3** Active rules, Violations and Timeline views; diagnostics with rule ids; L2 verify on save (SPEC §4.20.2). Verify: §4.20 EC-1, EC-5, EC-8.
- [x] **11.4** Palette commands through `run`, with human-only commands opening a pre-filled terminal (SPEC §4.20.3). Verify: §4.20 EC-7.
- [x] **11.5** Restart and reconnect behaviour; untrusted workspaces; the Cursor-compatible API floor. Verify: §4.20 EC-2–4, EC-6.

## 11.6 Live extension hardening

SPEC-first hardening for a live extension: connection, live data, real producers, polish and a real host E2E.

- [ ] **11.6.1** Connection correctness: spawn with `cwd`, root handshake, Windows path comparison, reconnect wiring, stderr surfaced (PR 1)
- [ ] **11.6.2** Live data path: log watcher with `events/appended` push, git-hook and verify verdict appends (PR 2)
- [ ] **11.6.3** Real data producers: versions, budget, health, remediation plan path (PR 3)
- [ ] **11.6.4** UX polish, extension only (PR 4)
- [ ] **11.6.5** Real extension-host E2E on all three OSes (PR 5)

## Exit gate

- `npm run ledger -- --covers "§4.20" "§4.19 EC-9" "§4.19 EC-10"` lists only the P1 view tests.
- `npm run test:extension` green on all three OSes, plus the VALIDATION always-set.
- The extension loads this repo in VS Code and shows its rules, findings and timeline.
- Leaf 11.6 adds the live checks: an external append reaches the Timeline with no user action, and killing the engine shows the retrying state before recovery.
- The PR5 scaffold (`packages/vscode/tests/e2e/`, runner `packages/vscode/scripts/run-e2e.mjs`) carries the gate asserts; each waits on its engine or extension PR and lands with it, never by loosening the scaffold:
  - every view populates (PR1 cwd and labels, PR3 producers);
  - an external append reaches the Timeline in under 3 s (PR2 watcher);
  - saving a file refreshes L2 diagnostics (PR1 paths, PR2 refresh);
  - killing the engine shows retrying, then recovers (PR1 reconnect);
  - no `0.0.0` anywhere (PR3 versions).
- Full-run observation on `main` (2026-11-07, VS Code 1.145.2 win32): the host cwd is the install dir and `initialize` answers it as `root` with no `version` field — the D1/D6 red proof.
- Rebase follow-up on `fix/pr5-e2e`: spawning the fixture launcher with the fixture folder as cwd answers the fixture folder as `root` with the real `engineVersion` (the version field is `engineVersion`, not `version`); the suite asserts both, and the remaining gates stay TODO-stubbed per the mapping above.
