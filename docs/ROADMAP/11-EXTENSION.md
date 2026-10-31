# 11. Extension

**[◀ 10. Self-Host](10-SELF-HOST.md)** · [Roadmap index](../ROADMAP.md) · **[12. P1 Scope ▶](12-P1-SCOPE.md)**

| | |
|---|---|
| **Depends on** | Phase 10 (may run in parallel with phase 12) |
| **Delivers** | The stdio server and the VS Code extension with the P0 views: Active rules, Violations, Timeline; L2 on save |
| **Read** | SPEC §4.19.5, §4.20, §7.15, §11 S6, S28; PRD §12 #2, #22 |
| **Covers** | `§4.20`, `§4.19 EC-9`, `§4.19 EC-10` |

## Steps

- [x] **11.1** `serve --stdio`: JSON-RPC methods of SPEC §7.15, `events/appended` notifications, the human-only answer for `run`. Verify: §4.19 EC-9, EC-10.
- [x] **11.2** Extension shape: the CommonJS shim and ESM main, activation, the trust requirement, one server per workspace folder, version handshake, setup welcome for repos without Codictator (SPEC §4.20.1). Verify: §4.20 EC-9; unit tests with the fake `vscode` API.
- [ ] **11.3** Active rules, Violations and Timeline views; diagnostics with rule ids; L2 verify on save (SPEC §4.20.2). Verify: §4.20 EC-1, EC-5, EC-8.
- [ ] **11.4** Palette commands through `run`, with human-only commands opening a pre-filled terminal (SPEC §4.20.3). Verify: §4.20 EC-7.
- [ ] **11.5** Restart and reconnect behaviour; untrusted workspaces; the Cursor-compatible API floor. Verify: §4.20 EC-2–4, EC-6.

## Exit gate

- `npm run ledger -- --covers "§4.20" "§4.19 EC-9" "§4.19 EC-10"` lists only the P1 view tests.
- `npm run test:extension` green on all three OSes, plus the VALIDATION always-set.
- The extension loads this repo in VS Code and shows its rules, findings and timeline.
