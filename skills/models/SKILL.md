---
name: models
description: 'List available Claude models from the Anthropic Models API with a 24-hour cache and CLI-alias fallback. Args: --refresh, --json.'
---

# Claude Code Models

Use this skill when the user wants to inspect available Claude models or refresh the model catalog.

Resolve `<plugin-root>` as two directories above this `SKILL.md` file. Run:
`node "<plugin-root>/scripts/claude-companion.mjs" models $ARGUMENTS`

Supported arguments:
- `--refresh` bypasses the local catalog cache.
- `--json` returns the structured catalog instead of a Markdown table.

The command is read-only. If Anthropic API credentials are unavailable or the catalog request fails,
it returns the cached catalog when possible, otherwise the Claude CLI aliases `opus`, `sonnet`, and
`haiku`. API keys are never stored in the catalog cache.

Output:
- Present the companion stdout faithfully.
