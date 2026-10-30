# 4.9 records

**[◀ 4.8 deps](04-08-DEPENDENCIES.md)** · [SPEC index](../SPEC.md) · **[4.10 testing ▶](04-10-TESTING.md)**

Documentation architecture (PRD §8 F10), change history (F8) and the bug registry (F15). Limits are §5 rows; record grammars are §7.7.

## 4.9.1 Doc classes

Every Markdown file is classified by path, first match wins:

| Class | Matches | Checks |
|---|---|---|
| Record | `docs/HISTORY/*.md`, `docs/BUGS/*.md` | Grammar (§7.7), the record rules of §4.9.3–§4.9.4 and `core/doc-size`; exempt from density and breadth |
| Managed | Files or blocks in the guardrail manifest (§4.14) | Integrity only |
| Router | `docs/<NAME>.md` with a sibling folder `docs/<NAME>/` | Router rules (§4.9.2) |
| Leaf | `docs/<NAME>/*.md` | Name, navigation, size, breadth, density |
| Single | Any other placed Markdown file | Size, breadth, density |

Record folders have no router: their file names (`YYYY-MM-DD`, `YYYY`) order them, so `core/doc-router-leaf` and leaf naming do not apply, and `docs/HISTORY.md` and `docs/BUGS.md` may not exist.

## 4.9.2 Checks

| Rule | Decidable check |
|---|---|
| `core/doc-placement` | Markdown only at: repo-root `README.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`; `docs/*.md`; `docs/<NAME>/*.md`; `packages/*/README.md`; harness asset dirs (`.agents`, `.claude`, `.github`, `.cursor`, `.gemini`, `.opencode`, `.muse`); `.codictator/`; plus `allowedGlobs`. Never `docs/HISTORY.md` or `docs/BUGS.md` |
| `core/doc-one-level` | No folder below `docs/<NAME>/` |
| `core/doc-router-leaf` | Router holds only an H1, an optional one-line intro and tables; each leaf linked exactly once, in file-name order; every leaf named `^\d{2}(-\d{2})?-[A-Z0-9]+(-[A-Z0-9]+)*\.md$`; every leaf's first non-heading line is a navigation line linking previous leaf (or "(first)"), the router, and next leaf (or "(last)"), matching router order |
| `core/doc-size` | Bytes and lines per file |
| `core/doc-breadth` | `##` headings per file; Markdown files per folder |
| `core/doc-density` | Words per sentence; sentences per paragraph. Tables, code blocks, headings and link-only lines are excluded; each list item is one paragraph. A sentence ends at `.`, `!` or `?` followed by whitespace and then anything but a lowercase letter, or by the end of the paragraph; never inside a code span or after `e.g.`, `i.e.`, `etc.`, `vs.`, `cf.`. Words are whitespace-separated tokens containing a letter or digit; a code span counts as one word |
| `core/doc-links-valid` | Every relative link resolves to a file; every `#anchor` matches a GitHub-style heading slug in the target |
| `core/doc-no-inline-changelog` | In non-record docs: no heading matching `(?i)^(change ?log\|history\|revisions?\|what'?s new\|updates?)$`; no line matching `(?i)^[-*]?\s*(updated\|changed\|added\|revised\|amended)( on)?\s+\d{4}-\d{2}-\d{2}` |
| `core/doc-no-corpus-counts` | No sentence matching `(?i)\b(this\|the)\s+(corpus\|repo(sitory)?\|docs?\|spec\|prd\|folder)\s+(has\|contains\|holds\|consists of)\s+\d+` |
| `core/doc-single-owner` | No sentence of ≥ 12 words appears, after whitespace and case normalisation, in two non-record docs |

Runs at L1 on `tool.post.write` of a `.md` file (that file plus link targets), L3 on staged docs, L4 on all docs.

## 4.9.3 Change history (F8)

| Aspect | Specification |
|---|---|
| Where | `docs/HISTORY/<YYYY-MM-DD>.md` for the commit's day (UTC); when an append would exceed `core/doc-size`, the next file is `<YYYY-MM-DD>-2.md`, then `-3` |
| Unit | One entry per commit, added in that commit, whose `Subject` equals the commit subject |
| Kind | Derived from the commit's paths after dropping record files (the entry itself, bug rows). Each remaining path takes the first matching class: `guardrail` (listed in the manifest, §4.14.1), `deps` (manifest, lockfile or toolchain file, §4.8.1), `docs` (non-record Markdown, or repo metadata without behaviour: `LICENSE*`, `NOTICE*`, `.gitattributes`, `.gitignore`, `.editorconfig`), else `code`. One class across all paths gives the kind; mixed classes give `code`. A commit touching only record files is `docs` |
| Fields | Kind, Task and Why always; `code` adds What went wrong (`none` allowed), Trade-offs, Lessons; `docs` adds Docs (the touched non-record files, or `none`), which is the per-doc changelog; `deps` adds one Deps line per change; `guardrail` adds nothing. A fix commit adds Bug. Grammar §7.7 |
| Exempt | Merge commits, and the bot commits of a qualifying bot PR, which the entry of its appended commit covers (§4.15.3). Reverts are not exempt; they record why |
| Merging | Never squash (§11 S33): a squash collapses commits and rewrites subjects, orphaning their entries. Merge commits and rebase merges keep one entry per commit; `core/branch-protection` checks the host setting (§4.15.2) |

| Rule | Check |
|---|---|
| `core/history-entry` | L3 `commit-msg`: the staged diff adds exactly one entry whose Subject equals the message subject. L4: every non-merge commit in range adds one |
| `core/history-append-only` | For every file in `docs/HISTORY/`, the base content after the title line is a suffix of the head content (after `normalizeText`): new entries are prepended directly under the title, and existing entries are never edited |
| `core/history-entry-complete` | Required fields for the kind present and non-empty |

## 4.9.4 Bug registry (F15)

`docs/BUGS/<YYYY>.md` for the year the defect was found, one table row per defect (grammar §7.7). It rolls over to `-2`, `-3` like history files.

| Rule | Check |
|---|---|
| `core/bug-registry` | A commit of type `fix` has a history entry with `Bug: BUG-####` naming an existing row; after the commit that row is `fixed` and its regression test path exists |
| `core/bug-rows-immutable` | A row changes once, from `open` to `fixed` or `wontfix`, filling Fix and, for `fixed`, Regression test; no other cell changes and no row disappears. A recurring defect gets a new row |
| `core/diagnose-before-fix` | A task of type `fix` cannot enter implementation without `diagnosis` (reproduction and root cause) in its record (§4.12.2) |

## 4.9.5 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Router contains a paragraph | Block `core/doc-router-leaf` |
| EC-2 | Leaf missing from router, or linked twice | Block |
| EC-3 | Nav line points to wrong next leaf after insertion | Block, remediation lists the expected nav line |
| EC-4 | `docs/SPEC/sub/x.md` | Block `core/doc-one-level` |
| EC-5 | Link to `02-STACK.md#2.1-toolchain` where slug is `21-toolchain` | Block, remediation gives the correct slug |
| EC-6 | Sentence with `e.g.` mid-sentence | Not split |
| EC-7 | 45-word sentence inside a table cell | Not counted |
| EC-8 | Existing history entry edited in place | Block `core/history-append-only`; prepending a new entry directly under the title does not block |
| EC-9 | Commit with no history entry | L3 blocks; if bypassed, L4 blocks the PR |
| EC-10 | Two entries in one commit | Block; one commit, one entry |
| EC-11 | Commit message subject amended after entry written | L3 compares at `commit-msg` time, so the mismatch is caught |
| EC-12 | Fix commit naming a non-existent `BUG-0999` | Block |
| EC-13 | Bug row deleted | Block `core/bug-rows-immutable` |
| EC-14 | Day rollover during a session | New file for the new UTC day; old file untouched |
| EC-15 | CRLF history file on Windows | Prefix check uses normalised text; passes if only line endings differ |
| EC-16 | Squash merge lands one commit adding three entries on the default branch | The push run blocks `core/history-entry` (one commit, one entry); `core/branch-protection` already blocked while squash was allowed |
| EC-17 | Commit touching `LICENSE`, `README.md` and its own history entry | Kind `docs`; Docs lists `LICENSE` and `README.md` |
| EC-18 | Commit touching `.gitignore` and `src/a.ts` | Kind `code` |
| EC-19 | Commit adding only an `open` bug row and its history entry | Kind `docs`, Docs `none` |
| EC-20 | Bug row edited from `fixed` back to `open` | Block `core/bug-rows-immutable` |
| EC-21 | `docs/HISTORY.md` created | Block `core/doc-placement` |
