# 4. Engine Core

**[◀ 3. Kernel](03-KERNEL.md)** · [Roadmap index](../ROADMAP.md) · **[5. Packs and Security ▶](05-PACKS-SECURITY.md)**

| | |
|---|---|
| **Depends on** | Phase 3 |
| **Delivers** | The event log, config resolution with the human-only path, and the deterministic evaluator with tiers, waivers, ratchet, messages and fail closed |
| **Read** | SPEC §4.18.1, §4.2, §4.3, §7.2, §7.5, §7.6, §7.10, §8 (E1xx, E8xx, E9xx); PRD §6 P1, P2, P5, P9 |
| **Covers** | `§4.2`, `§4.3`, `§4.18 EC-1..3` |

## Steps

- [ ] **4.1** audit: event append with line-atomic writes, size rotation, truncation marker (SPEC §4.18.1). Verify: §4.18 EC-1–3; the 20-parallel-appenders row of §10.5.
- [ ] **4.2** config: resolution steps and validation rules (SPEC §4.2.1, §4.2.2), `EffectiveConfig` and `configHash`. Verify: §4.2 EC-1–9, EC-11.
- [ ] **4.3** Human-only guard: TTY check and agent markers (SPEC §4.2.3). Verify: §4.2 EC-10.
- [ ] **4.4** engine: rule model, trigger selection, concurrent enforcers under budget, decision, verdict event appended before return. Verify: §4.3 EC-1, EC-4, EC-12, EC-15.
- [ ] **4.5** Fail closed with `CDX-E901`–`E903` (SPEC §4.3.8). Verify: §4.3 EC-2, EC-3.
- [ ] **4.6** Waivers with bounds, expiry and one renewal (SPEC §4.3.4). Verify: §4.3 EC-5–7.
- [ ] **4.7** Ratchet against `baseline.json`, touched-file rule, renames, measure versions (SPEC §4.3.5). Verify: §4.3 EC-8–11, EC-16–18.
- [ ] **4.8** Agent message within its byte budget, redacted through the kernel's `redactSecrets` (SPEC §4.3.7). Verify: §4.3 EC-13, EC-14 and the §4.3 budget test.

## Exit gate

- `npm run ledger -- --covers "§4.2" "§4.3" "§4.18 EC-1..3"` exits 0.
- Always-set and `npm run test:stress` green on all three OSes.
- §10.3 item 4 still green: `engine` imports only `kernel`, `config` and `audit`.
