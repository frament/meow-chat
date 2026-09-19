---
description: Analyze and process a GitHub issue. Usage: /issue <N> [fix] — reads issue via gh, analyzes the codebase (LeanKG first), outputs a root-cause analysis + plan; with "fix" also implements and validates.
---

You are processing a GitHub issue for this repository. Follow the workflow below.

## 1. Read the issue
- Determine repo: `gh repo view --json nameWithOwner -q .nameWithOwner` (fall back to `git remote get-url origin`). Call it `$REPO`.
- `gh issue view <NUMBER> --repo $REPO --json number,title,state,labels,body,comments,assignees,milestone`
- Arguments: `$ARGUMENTS`
- Parse `$ARGUMENTS`: first token is the issue NUMBER (required). If it contains the word `fix` (any position), mode = IMPLEMENT; otherwise mode = ANALYSIS-ONLY.

## 2. Analyze (LeanKG is MANDATORY first)
Per repo AGENTS.md, before any codebase search use LeanKG:
- `mcp_status` / leankg tools: `concept_search`, `find_function`, `search_code`, `get_impact_radius`, `get_dependents`, `get_tested_by`, `get_context`.
- Only if LeanKG returns empty/incomplete results may you fall back to grep/glob.
- Trace the real flow end to end: every file the change touches, actual callers, before deciding on a fix.

## 3. Output a structured analysis
Always produce:
- **Root cause** (in the issue's language — Russian if the issue is Russian)
- **Affected files** (file:line)
- **Plan** (minimal diff; prefer stdlib/existing code; call out anything the issue describes that is already implemented or a duplicate)
- **Open questions**, if any (ask the user, don't assume)

## 4. Mode: ANALYSIS-ONLY (default)
Stop after step 3. Do not edit code. If the issue body asks a question or is unclear, summarize and wait.

## 5. Mode: IMPLEMENT ("fix")
- Implement the minimal fix per the plan.
- Verify: run the repo's relevant checks (see AGENTS.md Commands; backend: `make test-backend` or scoped `go test`, frontend: `npm run build`). No lint config exists in this repo.
- Do NOT commit/push unless the user explicitly asks. Do NOT create a PR unless asked.
- If you were asked to, report the result back on the issue: `gh issue comment N --repo $REPO --body "..."` and/or `gh issue close N`. Only do GitHub mutations when the user requested them.

## Rules
- Root-cause fix, not symptom patch: if several paths share the bug, fix the shared function.
- Smallest working diff; match repo conventions (AGENTS.md + surrounding code).
- Never edit secrets, never expose tokens (gh uses its own keyring).
