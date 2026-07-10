---
name: transfer
description: 'Start a fresh Claude Code session from the current Codex thread transcript. Args: --wait, --background, --model <model>, --effort <auto|low|medium|high|xhigh|max>, --source <path>, --prompt-file <path>. Prints claude --resume <session_id>.'
---

<!--
Copyright 2026 Sendbird, Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Claude Code Transfer

By default, hand this skill off through Codex's built-in `default` subagent.
Do not answer the request inline in the main Codex thread.
Spawn exactly one transfer forwarding subagent whose only job is to run one companion `transfer` command and return that stdout unchanged.
Foreground transfer responses must be that subagent's output verbatim.

Use this skill when the user wants to hand off the current Codex thread history to a fresh Claude Code session.

Resolve `<plugin-root>` as two directories above this `SKILL.md` file. Always run the companion from that active plugin root:
`node "<plugin-root>/scripts/claude-companion.mjs" transfer ...`

Raw slash-command arguments:
`$ARGUMENTS`

Supported arguments: `--wait`, `--background`, `--model <model>`, `--effort <auto|low|medium|high|xhigh|max>`, `--source <path>`, `--prompt-file <path>`

Main-thread routing rules:
- If the user explicitly invoked `$cc:transfer` or `Claude Code Transfer`, do not keep the work in the main Codex thread. Delegate it.
- Treat `--background` and `--wait` as Codex-side execution controls only. Never forward either flag to `claude-companion.mjs transfer`.
- If the user explicitly passed `--background`, run the transfer subagent in the background.
- If the user explicitly passed `--wait`, run in the foreground.
- If neither flag is present, prefer foreground. Transfer should only bootstrap a new Claude session and print a resume command.
- Forward `--model`, `--effort`, `--source`, and `--prompt-file` unchanged.
- Do not inspect the repo, read files, poll job status, or summarize the result in the same turn.
- If the companion reports missing setup or authentication, direct the user to `$cc:setup`.

Transcript source:
- The companion first resolves the current Codex thread id from the plugin's session routing context, specifically the `CODEX_THREAD_ID` value surfaced by `background-routing-context` / `session-routing-context`.
- It reads the current thread transcript through Codex app-server history APIs: `thread/read` and `thread/items/list`.
- If the app-server does not return usable transcript item payloads, use the documented fallback by passing `--source <path>` or `--prompt-file <path>` with a transcript file. Those two flags are aliases for transfer transcript input.
- The companion wraps transcript content in explicit untrusted-input delimiters before sending it to Claude Code.

Subagent launch:
- By default, use Codex's `spawn_agent` tool with `agent_type: "default"`.
- Never satisfy background transfer by launching `claude-companion.mjs transfer` itself as a detached shell process. Do not use `&`, `nohup`, detached `spawn`, or any equivalent direct background process launch from the parent.
- Prefer `fork_context: false` for the built-in transfer child. The parent should pass a self-contained forwarding message instead of replaying the full parent thread.
- The built-in transfer path must set `model: "gpt-5.4-mini"` and `reasoning_effort: "medium"` on `spawn_agent`.
- Before spawning the built-in child, emit one short commentary update that records the attempted subagent model selection.
- If `gpt-5.4-mini` is unavailable with an explicit model-availability error, retry once with `model: "gpt-5.4"` and the same `reasoning_effort: "medium"`.
- Do not use that fallback for arbitrary failures.
- Remove `--background` and `--wait` before spawning the subagent.

Forwarding message:
- The built-in transfer path must use a compact strict forwarding message. It must:
  - identify the child as a transient forwarding worker for Claude Code transfer
  - include exactly one shell command to run
  - run that command as one blocking foreground shell-tool call, not as a background terminal/session
  - if the available shell tool is `exec_command`, call it once in non-interactive mode and wait for command exit in that same call
  - tell the child to return that command's stdout text exactly, with no preamble, summary, code fence, trimming, normalization, or punctuation changes
  - tell the child to ignore stderr progress chatter such as `[cc] ...` lines and preserve only the stdout-equivalent final result text
  - tell the child not to inspect the repository, read files, grep, or perform the transfer directly
  - say that auth/setup failures from the companion must be returned unchanged

Execution:
- Foreground: spawn the transfer subagent, wait for it to finish, and return its stdout.
- Background: spawn the transfer subagent without waiting for it in this turn. The subagent still runs the companion `transfer` command in the foreground inside its own thread.

Output:
- Foreground: return the subagent's companion stdout exactly as-is. The expected successful output is exactly `claude --resume <session_id>`.
- Background: do not wait for the subagent output. After launching it, tell the user `Claude Code transfer started in the background. Check the subagent session or $cc:status for progress; it will print a claude --resume command when ready.`
