# /commit — Commit with Doc Updates

You are committing code changes and ensuring the project's documentation stays in sync. This skill handles staging, committing, and then checking if any docs or CLAUDE.md need updating based on what was committed.

## Scope

This skill maintains **code-coupled documentation**:
- Any doc carrying a `<!-- Source: ... -->` comment (none exist yet — see "Source mapping convention" below; enforce it on new docs)
- `CLAUDE.md` — detected via source comment plus structure/command heuristics
- `README.md` (root and `web/README.md`) — detected via heuristics

**Explicitly NOT handled by this skill** (deferred to `/update-brain`):
- `CHANGELOG.md` — session-level summarization is the right granularity, not per-commit
- `docs/decisions.md` — decision entries are session-level judgment calls

**Never touched:**
- `docs/crib_sheet.md` — frozen interview artifact (numbers verified 2026-07-12/13); never propose edits
- `reference/` — vendored read-only material. If a commit touches `reference/sdk/`, the only valid doc action is flagging that `reference/sdk/VENDORED_COMMIT` should be updated to the new upstream commit.

## Arguments

`$ARGUMENTS` — optional scope: `validators`, `executor`, `web`, `docs`, or `root`

## Step 1: Analyze Changes

Run these commands to understand the current state:

1. `git status` (never use `-uall` flag)
2. `git diff` to see unstaged changes
3. `git diff --cached` to see staged changes
4. `git log --oneline -5` to see recent commit message style

Categorize all changed files by scope:
- `validators/` → validators (Aiken on-chain)
- `executor/` → executor (Node/TS off-chain)
- `web/` → web
- `docs/` and `reference/` → docs
- Root-level files (CLAUDE.md, README.md, .gitignore, .claude/, etc.) → root

If there are no changes, say so and stop.

## Step 2: Scope Selection

**If `$ARGUMENTS` specifies a scope:**
- Filter to only that scope's changed files
- Skip to Step 3

**If `$ARGUMENTS` is empty:**
- List which scopes have changes and how many files in each
- Ask the user:
  - **"Single commit"** — commit all changes together in one commit
  - **"Per-scope"** — commit each scope separately (process them one at a time, repeating Steps 3–7 for each)

If the user chooses per-scope, process in this order: validators → executor → web → docs → root (on-chain first — executor and web depend on the validator's shape).

## Step 3: Stage Files

Stage the files for the selected scope. Be specific — add files by name, not with `git add -A` or `git add .`.

**Important:**
- Do NOT stage files that likely contain secrets — especially `executor/.env.local` or any `.env*` variant (gitignored, but check anyway; `EXECUTOR_SEED_PHRASE` is a hot wallet key)
- Do NOT stage large binaries or `validators/build/` artifacts unless explicitly part of the change
- Warn the user if you see any such files in the changes

## Step 4: Draft Commit Message

Analyze all staged changes and draft a commit message:

1. Determine the nature of the change (new feature, enhancement, bug fix, refactoring, docs, etc.)
2. If scoped, focus the message on that scope (e.g., changes only in `validators/` get a validator-focused message)
3. Keep it concise: 1–2 sentence summary focusing on "why" not "what"
4. End with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

**Present to user:**
- Show the list of staged files
- Show the proposed commit message
- Ask for approval or edits

Do NOT commit until the user approves.

## Step 5: Create the Commit

Create the commit using a HEREDOC for the message:
```bash
git commit -m "$(cat <<'EOF'
Commit message here.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

Run `git status` after to verify success.

If the commit fails due to a pre-commit hook, fix the issue and create a NEW commit (never amend).

## Step 6: Check Docs for Staleness

Now check if any documentation needs updating based on what was just committed.

**6a. Get committed files:**
```bash
git diff HEAD~1 --name-only
```

**6b. Source mapping convention:**

Docs that describe specific source files carry an HTML comment at the top:
```markdown
<!-- Source: validators/validators/vault.ak, executor/src/strategies/trigger.ts -->
```
Globs are allowed (`executor/src/chain/*.ts`). For every doc under `docs/` (except `decisions.md` and `crib_sheet.md`) and `CLAUDE.md`:
1. Parse the `<!-- Source: ... -->` comment if present
2. Check if any listed source files/globs overlap with the committed files
3. If yes → that doc needs review

**Also check for:**
- **New docs without a Source comment** — if the commit added a doc under `docs/` that describes source files but has no `<!-- Source: ... -->` comment, flag it: propose adding one (this is how the convention propagates)
- **New source files** not covered by any doc's source mapping — flag as "new file not covered by docs"

**6c. Heuristic checks (README.md, CLAUDE.md — no source comments needed):**

**Heuristic A — executor/package.json scripts drift → README / CLAUDE.md:**

If the commit touched `executor/package.json`:
1. `git show HEAD~1:executor/package.json` for the before-version
2. Diff the `scripts` block: compute **added**, **removed**, and **renamed** (removed+added pairs with matching command bodies)
3. For each changed script name, grep root `README.md` and `CLAUDE.md` for the **invocation pattern** (`npm run <name>`, `npx <name>`) with word boundaries
4. Hits → flag `[UPDATE]` with line references (cite at most the first 3 line numbers plus a total count)
5. Added script with zero hits → flag `[MAYBE]` (doc might benefit from mentioning it)

**Heuristic B — Aiken project config → CLAUDE.md / README:**

If the commit touched `validators/aiken.toml` (compiler version, plutus version, dependencies): grep `CLAUDE.md` and `README.md` for the old values (e.g., `v1.1.23`, `Plutus V3`, stdlib version) and flag `[UPDATE]` on hits.

**Heuristic C — Top-level structure change → README.md / CLAUDE.md:**

If the commit added or removed a directory at depth 1–2 under `validators/`, `executor/src/`, `web/`, or the repo root:
1. Root `README.md` has a "Layout" table and `CLAUDE.md` has an "Architecture" section
2. Flag `[UPDATE]` with the specific directory change ("added `executor/src/farm/`", "removed `web/`")

**Heuristic D — Test infra change:**

If the commit added or removed (modifications alone don't trigger) files matching `executor/**/*.test.ts`, `executor/vitest.config*`, or Aiken `test` blocks appearing in a previously test-free `.ak` file → flag `CLAUDE.md`'s Commands section as `[MAYBE]` (test commands may need updating). There is no TESTING.md in this repo.

**6d. If no docs need updating:**
Say "No doc updates needed" and stop. The commit is done.

## Step 7: Propose Doc Updates

For each doc that needs review:

1. Read the current doc
2. Read the committed source file changes (`git show HEAD -- path/to/file` or read the file directly)
3. Identify what's different between the doc and the current source code
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

## Step 8: Apply Doc Updates

Write only the approved changes. For each update:
1. Read the target doc
2. Make the specific change (edit, not rewrite)
3. If the doc's scope changed (new source files now relevant, old ones removed), update the `<!-- Source: ... -->` comment to match
4. Show a brief summary of what changed

After all updates are applied, stage the changed docs and commit:
```bash
git commit -m "$(cat <<'EOF'
docs: update X based on Y changes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

## Step 9: Summary

Show a final summary:
- Code commit hash and message
- Doc commit hash and message (if any)
- Any flagged items that weren't addressed (new files without doc coverage, docs missing Source comments, etc.)

---

## Rules

- **Never amend commits.** Always create new commits.
- **Never force push.** Never use `--force` or `--no-verify`.
- **Never commit secrets.** Warn about `.env*` files, seed phrases, API keys.
- **Stage specific files.** Never use `git add -A` or `git add .`.
- **Never edit `reference/` or `docs/crib_sheet.md`.**
- **Doc updates are optional.** If the user rejects all proposals, the code commit already succeeded.
- **Keep doc edits surgical.** Update the specific section that's stale, don't rewrite entire docs.
- **Match existing style.** decisions.md-style dashes, README tables, etc.
- **CLAUDE.md stays high-level.** Significant new detail goes in a doc under `docs/` (with a Source comment); CLAUDE.md gets brief pointer updates.
