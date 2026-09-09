---
name: gh-issue-processing
description: "Process a GitHub issue end to end: read it with gh, analyze the codebase (LeanKG first per AGENTS.md), output root-cause analysis + plan, and optionally implement + report back. Use when the user references a GitHub issue by number or asks to triage/analyze/fix an issue (e.g. 'issue #1', 'обработай issue', '/issue')."
---

# GitHub Issue Processing

Standard workflow for turning a GitHub issue into analysis (and optionally a fix).

## 1. Read the issue
- Repo: `gh repo view --json nameWithOwner -q .nameWithOwner` (fallback: `git remote get-url origin`).
- `gh issue view <N> --repo <REPO> --json number,title,state,labels,body,comments,assignees,milestone`.
- `gh` must be installed and authenticated (`gh auth status`). Issues on public repos are also readable via the REST API with curl if gh is missing.

## 2. Analyze — LeanKG is MANDATORY first
Before ANY codebase search use LeanKG (`mcp_status`, `concept_search`, `find_function`, `search_code`, `get_impact_radius`, `get_dependents`, `get_tested_by`, `get_context`). Fall back to grep/glob only if LeanKG returns empty/incomplete. Trace the real flow (callers, dependents) before choosing a fix.

## 3. Report structure
Produce, in the issue's language (Russian if the issue is Russian):
- Root cause
- Affected files (`file:line`)
- Minimal plan (stdlib/existing code first; flag anything already implemented or a duplicate)
- Open questions (ask, don't assume)

## 4. Fixing
- Only implement when asked (`fix` in the request). Smallest working diff, repo conventions (AGENTS.md).
- Verify with the repo checks from AGENTS.md Commands.
- Commit/push/PR and GitHub mutations (`gh issue comment/close`) only on explicit request.

## Companion
There is an opencode command with this exact workflow: `.opencode/command/issue.md` (`/issue <N> [fix]`).
