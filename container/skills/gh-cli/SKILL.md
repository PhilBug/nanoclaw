---
name: gh-cli
description: Use the GitHub CLI inside the NanoClaw runtime container for PR management, issue tracking, and repository operations.
allowed-tools: Bash(gh *)
---

# GitHub CLI

Use `gh` for GitHub operations from inside the NanoClaw runtime container.

## Before you start

Verify that `gh` is available and authenticated:

```bash
gh auth status
```

If `gh` is missing or authentication fails, stop and tell the user that GitHub CLI is not configured on this NanoClaw instance. Make sure `GH_TOKEN` is set in the host `.env` file.

## Common operations

```bash
gh pr list                          # List pull requests
gh pr view 123                      # View a PR
gh pr create --title "x" --body "y" # Create a PR
gh issue list                       # List issues
gh repo view                        # View current repo
gh api repos/{owner}/{repo}/...     # Call any GitHub API
```

## Rules

- Quote all arguments that may contain spaces.
- Use `--json` when you need structured output.
- Prefer `gh` over raw `git` commands for GitHub-specific operations (PRs, issues, releases).
