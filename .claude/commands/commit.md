# /commit — Commit with Doc Updates

You are committing code changes and ensuring the project's documentation stays in sync. This skill handles staging, checking whether any docs or CLAUDE.md need updating, and committing everything together — the doc pass runs **before** any commit is made, not after, so doc updates can be folded into the same commit(s) as the code they describe, or deliberately kept separate, as a decision made with the full picture in hand rather than discovered after the fact.

## Scope

This skill maintains **code-coupled documentation**:
- Any doc carrying a `<!-- Source: ... -->` comment — 9 under `legacy/docs/workflows/`
  (frozen, excluded below), plus 5 new ones for the current direction
  (`docs/mechanism-sqrtk.md`, `docs/fee-crystallization.md`,
  `docs/workflows/rebalance.md`/`deposit.md`/`redeem.md`) currently all reading
  `<!-- Source: none yet -->` since no validator exists to cite — that's a real
  value, not a placeholder to "fix": leave it until an actual source file
  exists, then update it and start enforcing staleness checks against it (see
  "Source mapping convention" below)
- `CLAUDE.md` — detected via source comment plus structure/command heuristics
- `README.md` (root and `web/README.md`) — detected via heuristics

**Explicitly NOT handled by this skill** (deferred to `/update-brain`):
- `CHANGELOG.md` — session-level summarization is the right granularity, not per-commit
- `docs/decisions.md` — decision entries are session-level judgment calls

**Never touched:**
- `docs/crib_sheet.md` — frozen interview artifact (numbers verified 2026-07-12/13); never propose edits
- `reference/` — vendored read-only material. If a commit touches vendored content, the only valid doc action is flagging that the relevant `VENDORED_COMMIT` should be updated to the new upstream commit/version — that's a normal part of re-vendoring, not an exception.
- `legacy/` — frozen by design (2026-07-30, D26: the archived auto-compounding
  app). If a commit ever does touch something under `legacy/` (unusual — it's
  meant to be preserved, not maintained), do NOT run the staleness check
  against it: don't propose keeping `legacy/docs/workflows/*.md` in sync with
  `legacy/validators/`/`legacy/executor/` changes the way this skill would for
  live code. A deliberate historical fix there doesn't imply the surrounding
  docs need updating too.

## Arguments

`$ARGUMENTS` — optional scope: `scripts`, `legacy`, `web`, `docs`, or `root`

## Step 1: Analyze Changes

Run these commands to understand the current state:

1. `git status` (never use `-uall` flag)
2. `git diff` to see unstaged changes
3. `git diff --cached` to see staged changes
4. `git log --oneline -5` to see recent commit message style

Categorize all changed files by scope:
- `scripts/` → scripts (Python √k toolkit — the active codebase)
- `legacy/` → legacy (frozen archive; see the exclusion above — commit it if
  asked to, but don't run doc-staleness detection against it)
- `web/` → web (not started for either the old or current direction)
- `docs/` and `reference/` → docs
- Root-level files (CLAUDE.md, README.md, .gitignore, .claude/, etc.) → root

If there are no changes, say so and stop.

## Step 2: Scope Selection

This decides how the **code** changes will eventually be grouped into commits. It does not decide how doc updates get committed — that's Step 7, once the doc pass has actually run and you know what it found.

**If `$ARGUMENTS` specifies a scope:**
- Filter to only that scope's changed files
- Skip to Step 3

**If `$ARGUMENTS` is empty:**
- List which scopes have changes and how many files in each
- Ask the user:
  - **"Single"** — treat all changes as one group
  - **"Per-scope"** — keep scopes as separate groups (scripts → legacy → web → docs → root order if it matters later)

Don't stage or commit anything yet based on this choice beyond what Step 3 does — it's just bookkeeping for Step 7.

## Step 3: Stage Files

Stage **all** the files intended for this commit pass — regardless of whether Step 2 chose single or per-scope, since the doc-staleness check in Step 4 needs to see the complete picture (a stale-doc heuristic can span what were categorized as separate scopes). Be specific — add files by name, not with `git add -A` or `git add .`. If per-scope grouping matters for Step 7, keep a mental (or written) note of which scope each staged file belongs to.

**Important:**
- Do NOT stage files that likely contain secrets — especially `automation/sqrtk/.env` (Blockfrost project ID) or any `.env*` variant (gitignored, but check anyway). If ever committing something under `legacy/`, the same applies to `legacy/executor/.env.local` (`EXECUTOR_SEED_PHRASE` is a hot wallet key, from when that scaffold was live).
- Do NOT stage large binaries or build artifacts unless explicitly part of the change — `legacy/validators/build/`, `automation/sqrtk/__pycache__/`, `scripts/dispersion/adapose_dispersion/` (should already be gitignored; flag it if you see any about to be staged anyway). If something you expect to see staged doesn't show up in `git status`, check `git check-ignore -v <path>` before assuming it's fine — a blanket `.gitignore` pattern (e.g. a bare `dist/`) can silently swallow a legitimately-wanted file with no error.
- Warn the user if you see any such files in the changes

## Step 4: Check Docs for Staleness

Now check if any documentation needs updating based on what's staged — **before anything is committed.**

**4a. Get the pending file list:**
```bash
git diff --cached --name-only
```

**4b. Source mapping convention:**

Docs that describe specific source files carry an HTML comment at the top:
```markdown
<!-- Source: legacy/validators/validators/vault.ak, legacy/executor/src/strategies/trigger.ts -->
```
Globs are allowed. For every doc under `docs/` (except `decisions.md` and `crib_sheet.md`) and `CLAUDE.md`:
1. Parse the `<!-- Source: ... -->` comment if present
2. Check if any listed source files/globs overlap with the staged files
3. If yes → that doc needs review, **unless** both the doc and its source live under `legacy/` — see the scope exclusion above, skip it

**Also check for:**
- **New docs without a Source comment** — if the pending changes add a doc under `docs/` (not `legacy/docs/`) that describes source files but has no `<!-- Source: ... -->` comment, flag it: propose adding one (this is how the convention propagates)
- **New source files** not covered by any doc's source mapping — flag as "new file not covered by docs". Doesn't apply to `legacy/` or to `scripts/` (its own doc is `automation/sqrtk/SQRTK_RUNBOOK.md`, updated by hand as part of the work, not by this skill's heuristics below — none of them target Python).

**4c. Heuristic checks (README.md, CLAUDE.md — no source comments needed):**

**Heuristic A — `automation/sqrtk/` tool interface drift → README / CLAUDE.md / SQRTK_RUNBOOK.md:**

If the pending changes touch `automation/sqrtk/sqrtk_core.py`, `automation/sqrtk/fetch_snapshots.py`, `automation/sqrtk/enumerate_minswap.py`, or `automation/sqrtk/enumerate_wingriders.py` in a way that changes a CLI flag, a default, or the CSV schema (new/renamed/removed column): grep `CLAUDE.md`'s Commands section and `automation/sqrtk/SQRTK_RUNBOOK.md` for the old invocation/column name. Hits → flag `[UPDATE]` with line references. This is the current-direction analog of the old Heuristic A (which was `executor/package.json` scripts drift) — same idea, different stack. Doesn't apply to `scripts/dispersion/` — that's a standalone side-script with no CLI-flag/schema contract documented elsewhere to drift out of sync.

**Heuristic B — N/A right now:**

The old Heuristic B checked `validators/aiken.toml` (Aiken compiler/Plutus version) against `CLAUDE.md`/`README.md` — nothing at the repo root uses that toolchain anymore. Revive the same pattern (grep for stale version strings) whenever a validator gets built again for the current direction; until then this heuristic has nothing to check.

**Heuristic C — Top-level structure change → README.md / CLAUDE.md:**

If the pending changes add or remove a directory at depth 1–2 under `scripts/`, `automation/`, `web/`, `docs/` (not `legacy/` — that tree is frozen, see the scope exclusion), or the repo root:
1. Root `README.md` has a "Layout" table and `CLAUDE.md` has an "Architecture" section
2. Flag `[UPDATE]` with the specific directory change ("added `automation/sqrtk/enumerate_splash.py`", "removed `web/`")

**Heuristic D — Test infra change:**

If the pending changes add or remove (modifications alone don't trigger) a `mock_*.py` file under `automation/sqrtk/`, or a new offline-verification path in `selftest.py` → flag `CLAUDE.md`'s Commands section as `[MAYBE]` (the "run before anything else" offline pre-flight list may need updating) and `automation/sqrtk/SQRTK_RUNBOOK.md`'s section 4 as `[UPDATE]` if a new mock isn't listed there.

**4d. If no docs need updating:**
Say "No doc updates needed" and go straight to Step 7 with just the code changes.

## Step 5: Propose Doc Updates

For each doc that needs review:

1. Read the current doc
2. Read the pending source file changes (`git diff --cached -- path/to/file`, or read the file directly)
3. Identify what's different between the doc and the pending source code
4. Determine if the difference is doc-relevant:
   - **Yes:** behavioral change, new/removed validator path or redeemer, changed datum shape, new/removed command, changed data flow
   - **No:** formatting, comments, variable renames, internal refactoring that doesn't change the documented interface

Present a numbered list of proposed updates. Classifications:
- **`[UPDATE]`** — doc is definitely stale, change is clear
- **`[MAYBE]`** — heuristic suggests review, but it's a judgment call
- **`[SKIP]`** — change is internal/cosmetic, no doc update needed
- **`[FLAG]`** — new file or feature not covered anywhere, consider adding a doc (or a Source comment)

```
1. [UPDATE] CLAUDE.md
   Architecture section: vault.ak gained a Burn redeemer path — the three-path
   description is now four

2. [MAYBE] README.md
   New `executor/src/farm/` directory — Layout table doesn't mention farm handling

3. [SKIP] executor/src/chain/indexer.ts
   Internal refactor, no documented interface changed

4. [FLAG] docs/farm-integration.md
   New doc describing executor/src/farm/ but missing a <!-- Source: ... --> comment
```

**Wait for approval.** Ask: "Which of these should I apply? You can approve all, pick specific numbers, or suggest changes."

Do NOT write any files until the user approves.

## Step 6: Apply Doc Updates

Write only the approved changes. For each update:
1. Read the target doc
2. Make the specific change (edit, not rewrite)
3. If the doc's scope changed (new source files now relevant, old ones removed), update the `<!-- Source: ... -->` comment to match
4. Stage the changed doc file (`git add`) — do **not** commit yet
5. Show a brief summary of what changed

If the user rejects all proposals (or Step 4 found nothing), proceed to Step 7 with just the code changes — nothing about reaching Step 7 depends on the doc pass finding or changing something.

## Step 7: Decide Commit Structure

Everything is now staged: the code changes from Step 3, and any approved doc updates from Step 6. Decide how this becomes actual commit(s) — this is the point the user picks between:

- **Single** — one commit, everything together (code + docs).
- **Per-scope, docs folded in** — one commit per scope from Step 2, each carrying its own relevant doc updates alongside its code. Doc updates that don't map cleanly to one scope (e.g. a CLAUDE.md Architecture-section update spanning multiple areas) go wherever makes most sense, or into a small trailing docs commit if none fits.
- **Wholly separate docs commit** — code commit(s) per Step 2's grouping (single or per-scope) as their own thing, then one dedicated trailing `docs: ...` commit carrying every doc update.

If Step 4 found nothing to update, this collapses to just Step 2's original single-vs-per-scope choice — ask only if that's still ambiguous.

Everything needed for every option is already staged in one index — splitting a single `git add`-ed set into multiple commits doesn't require re-staging, use `git commit -- <pathspec>` to commit only the matching staged paths in one commit while leaving the rest staged for the next.

## Step 8: Draft Commit Message(s) and Create the Commit(s)

For each commit decided on in Step 7, draft a message:

1. Determine the nature of the change (new feature, enhancement, bug fix, refactoring, docs, etc.)
2. If scoped, focus the message on that scope (e.g., changes only in `validators/` get a validator-focused message); a commit carrying folded-in docs can mention that briefly, it doesn't need its own separate message
3. Keep it concise: 1–2 sentence summary focusing on "why" not "what"
4. End with: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

**Present all proposed messages together, in commit order, before creating any of them:**
- Show the list of staged files going into each
- Show each proposed commit message
- Ask for approval or edits

Do NOT commit until the user approves.

Once approved, create each commit in order:
```bash
git commit -m "$(cat <<'EOF'
Commit message here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
(add `-- <pathspec>` if this commit is only a subset of what's staged, per Step 7)

Run `git status` after each to verify success.

If a commit fails due to a pre-commit hook, fix the issue and create a NEW commit (never amend).

## Step 9: Summary

Show a final summary:
- Every commit hash and message created this pass, in order
- Any flagged items that weren't addressed (new files without doc coverage, docs missing Source comments, etc.)

---

## Rules

- **Never amend commits.** Always create new commits.
- **Never force push.** Never use `--force` or `--no-verify`.
- **Never commit secrets.** Warn about `.env*` files, seed phrases, API keys.
- **Stage specific files.** Never use `git add -A` or `git add .`.
- **Never edit `reference/` or `docs/crib_sheet.md`.** Don't run doc-staleness detection against `legacy/` either (frozen, not maintained — see Scope above); committing something there if asked to is fine, proposing doc updates for it is not.
- **The doc pass runs before any commit, always.** Never commit code first and treat the doc pass as an optional afterthought — the whole point of this ordering is that the commit-structure decision (Step 7) is made with the full diff, code and docs together, in view.
- **Doc updates are optional.** If the user rejects all proposals, that just means Step 7 proceeds with only code changes — it doesn't change anything else about the flow.
- **Keep doc edits surgical.** Update the specific section that's stale, don't rewrite entire docs.
- **Match existing style.** decisions.md-style dashes, README tables, etc.
- **CLAUDE.md stays high-level.** Significant new detail goes in a doc under `docs/` (with a Source comment); CLAUDE.md gets brief pointer updates.
