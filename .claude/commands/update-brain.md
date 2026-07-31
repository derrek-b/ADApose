# /update-brain — Capture Session Knowledge

You are updating the "second brain" for the ADApose project. Your job is to review what happened in this session and propose updates to the project's knowledge base.

## Scope

This skill captures **session-level knowledge**: decisions made, conventions established, gotchas discovered, workflow changes, user-facing change history, and TODO items. It updates:

- `CLAUDE.md` (root — ADApose has no per-component CLAUDE.md files)
- `docs/decisions.md` — the D-numbered running log (currently D1–D10)
- `CHANGELOG.md` (root, single file — components aren't separately published packages yet; revisit if they diverge)

**Code-coupled docs** (anything with a `<!-- Source: ... -->` comment, plus README/CLAUDE.md staleness from specific commits) are maintained by the `/commit` skill. Don't duplicate that work here. However, if you notice obvious staleness from uncommitted work, flag it so the user can address it at commit time.

**Never touched:** `docs/crib_sheet.md` (frozen interview artifact) and `reference/` (vendored read-only).

## Step 1: Gather Context

Review everything that happened this session:

1. **Run `git diff HEAD`** in the repo root to see all uncommitted changes (staged + unstaged)
2. **Run `git log --oneline -20`** to see recent commits and identify which ones are from this session
3. **Review the conversation history** for decisions made, patterns discovered, gotchas encountered, or workflow changes — even if they haven't been coded yet

## Step 2: Identify What's Worth Capturing

### CLAUDE.md (root)
- New commands added or removed?
- New patterns or conventions established?
- Workflow changes (new build steps, new test commands, dev-loop stage reached — e.g., "Yaci DevKit verified" or "emulator harness working")?
- Structural changes (new directories, new files, reorganization)?
- Existing guidance that's now incorrect or incomplete?

### Decision entries (`docs/decisions.md`)

One file, D-numbered, dated entries — match the existing style exactly:
- Heading: `## D<next> · <Short title> — YYYY-MM-DD` (next number after the current highest)
- Terse dash-bullets; bold the load-bearing claim; cite sources in `reference/` where vendored
- Append at the end of the file — it's a chronological log

What earns an entry:
- An architecture decision was made or an existing one revisited/changed (if changed, the new entry references the old: "supersedes D<n>")
- **Platform knowledge**: a Minswap/Cardano quirk discovered, protocol behavior that differs from its docs, a bug caused by a platform misunderstanding — these are D-entries here, not a separate platform-knowledge directory
- An open question (like D6) got answered — update the OPEN entry's status inline AND note the resolution date
- Cost-model constants verified or corrected (D4 has a "re-verify in Week 1" list)

### CHANGELOG entries (`CHANGELOG.md`, root)

Session-level summarization is the right granularity, not per-commit. Group related commits into coherent entries under `[Unreleased]`, with H3 theme headings (e.g. "Validator", "Executor", "Docs & tooling") — create the file with this shape if it doesn't exist yet.

**What belongs:**
- Validator paths/invariants added, removed, or changed
- Executor behavior added or changed (trigger logic, batching, adapters)
- Breaking changes to datum/redeemer shapes
- New or retired commands and scripts
- Dependency changes with observable impact (e.g., the Lucid Evolution → SpaceBudz Lucid switch)

**What does NOT belong:**
- Pure internal refactors with no behavioral change
- Documentation-only updates (unless creating a new public doc)
- Build artifact refreshes (`validators/build/`, regenerated blueprints)
- Chore commits (`.gitignore` housekeeping, tooling config)

## Step 3: Propose Changes

Present a numbered list of proposed updates. For each one, show:
- **Target file** — which file to create or update
- **Change type** — create, add section/entry, update existing section, or remove outdated info
- **Content summary** — what you want to write (brief description, not the full text yet)

Format:
```
1. [UPDATE] docs/decisions.md
   Append D11: farm position CAN be script-owned (preprod round-trip verified) —
   resolves D6, per-pool aggregated farm position confirmed as the design

2. [UPDATE] CLAUDE.md
   "The one open unknown (D6)" section is now resolved — rewrite as settled design

3. [UPDATE] CHANGELOG.md
   [Unreleased] → Validator: Rescue redeemer for stray UTxOs (D10)

4. [SKIP] CHANGELOG.md
   Session was research-only, no behavior changed — not every session needs an entry
```

If nothing meaningful needs to be captured, say so. Don't force updates for trivial changes.

## Step 4: Wait for Approval

After presenting the list, **stop and wait**. Ask: "Which of these should I write? You can approve all, pick specific numbers, or suggest changes."

Do NOT write any files until the user approves.

## Step 5: Write Approved Changes

Once approved, write only the approved changes. Keep everything concise — the goal is a knowledge base that's quick to scan, not exhaustive documentation. Match each file's existing style.

After writing, show a brief summary of what was updated.

## Step 6: Check Personal Memory

Separately from the project knowledge base, check if anything from this session should be saved to your persistent memory directory (the file-based memory described in your system prompt — one fact per file with frontmatter, plus a pointer line in `MEMORY.md`). This is not part of the proposal/approval flow above — just do a quick self-assessment.

Things that belong in personal memory:
- User preferences or corrections ("never do X", "always prefer Y")
- Deferred work or TODOs that aren't tracked elsewhere
- Status of in-progress work that spans multiple sessions (e.g., "waiting on Minswap Discord answer re: D6")

Things that do NOT belong (they go in project docs instead):
- Anything about codebase structure or conventions (that's CLAUDE.md)
- Decisions or platform knowledge (that's docs/decisions.md)

If nothing needs recording, move on. If something does, write it directly — no approval needed for personal memory.
