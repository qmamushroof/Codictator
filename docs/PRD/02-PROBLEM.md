# 2. Problem

**[◀ 1. Product Identity](01-PRODUCT-IDENTITY.md)** · [PRD index](../PRD.md) · **[3. Scope Fence ▶](03-SCOPE-FENCE.md)**

## 2.1 Agents write code faster than anyone can review it

| Failure | Why it happens | Cost |
|---|---|---|
| Rules ignored | Instruction files are advisory; after compaction or a long session the rule is gone from context | Same defect re-introduced every session |
| User overrides quality | The agent obeys the latest prompt — "skip the tests", "just disable the check", "pin the old version" | Debt and vulnerabilities enter by request |
| Tests gamed | Asked to make a red test pass, an agent may delete the assertion, skip the test or widen the fixture | Green build that proves nothing |
| Architecture erodes | No compiler-level boundary; the shortest path crosses a module | A modular design decays into a ball of mud |
| Bloat | Agents re-implement what the platform or an existing package already provides, and over-explain in code and docs | More code to read, test and pay tokens for |
| Stale and vulnerable dependencies | Versions come from training data, not from a registry lookup | Known CVEs and deprecated APIs shipped confidently |
| Docs rot | Docs grow without bound, duplicate facts, carry inline history | Every session pays to read wrong text |
| No memory of *why* | Diffs show what changed, never what was tried and abandoned | Next session repeats the dead end |
| Token waste | Over-long sessions, repeated reads, unbounded context, verbose output | Higher cost and worse answers as context fills |

## 2.2 Existing answers each cover one slice

Rule-sync tools copy instructions into every harness but enforce nothing. Single-purpose hooks (TDD, secrets) enforce one concern for one harness. Spec tools structure the plan but do not verify the result. Linters, dependency bots and AI reviewers run after the fact and are advisory or bypassable. §4 has the detail.

## 2.3 The opportunity

A repo that wants agent-only development needs **all** of these rules enforced **together**, across **whichever harness** a contributor uses, **without** an LLM in the enforcement path. Assembling that by hand is weeks of hooks, scripts and CI work per repo, and it drifts. Codictator packages it, keeps it current, and makes it visible.
