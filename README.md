# session-band

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps your session's
vitals in view and makes the transcript easier to scan.

## What it does

**Under the prompt**: one row beside the hint line, with the model, the effort level, the context
window and the 5-hour plan limit, and a button that opens the usage panel:

```
⏸ manual mode on · ? for shortcuts   Opus 5.5 · 1M  effort ●●●○○ high  context ██░░ 17% · 171k/1M  5h ████░░ 42% · ↻ 2h 13m   [ Usage ▸ ]
```

Bars turn amber from 50% and red from 80%. On a narrow terminal the chips wrap below the hint.

**Usage panel** (`/usage-panel` or the **Usage ▸** button): cards for the 5-hour and weekly limits
with reset times and countdowns, the context window and the session cost, plus one-press switches
for the model and the effort level.

**Your prompts**: drawn in a rounded outline with a `❯ You · 14:32` header. Attached images stay
below it.

**Tool calls**: one row per call, tied together by a rail, with a status dot, an icon and a label,
the command or path, and lines changed and time taken at the right edge:

```
┃
●─ $ Run  ls -la ~/.claude                     20ms
┃
●─ ≡ Read  hooks/hooks.json                     2ms
┃
●─ ✎ Edit  src/app.ts                  +4 −2  120ms
```

| Icon | Label  | Tools                        |
| ---- | ------ | ---------------------------- |
| `$`  | Run    | Bash, PowerShell             |
| `≡`  | Read   | Read                         |
| `✎`  | Edit   | Edit, MultiEdit, NotebookEdit |
| `✚`  | Write  | Write                        |
| `⌕`  | Search | Grep, Glob                   |
| `⊕`  | Web    | WebFetch, WebSearch          |
| `◇`  | MCP    | any `mcp__*` tool            |

The status dot is green when a call succeeded, red when it failed, yellow when it was interrupted
and grey while it runs. Folded groups of reads and searches list each call (up to six, then
`… +N more`) instead of a count. Agents, todos and plan mode keep Claude Code's own rows.

**Long Bash output**: the transcript shows the first 8 and last 4 lines with `… N lines hidden`
between them. Claude still reads the full output.

Everything here changes only what is drawn: the stored conversation, and what the model reads,
are untouched. The mod makes no network calls, runs no processes and makes no model calls.

## Install

Needs Claude Code 2.1.287 or later. At the Claude Code prompt:

```
/plugin install session-band --marketplace AlessandroAriazzi/session-band
```

Answer `y` to add the marketplace, then press Enter for the user scope.

## Develop

Clone the repository and load it from its folder:

```sh
claude --plugin-dir ./session-band
```

or set `CLAUDE_CODE_PLUGIN_DIRS` to the folder in the `env` block of `~/.claude/settings.json`. An
interactive session reloads the mod when a file is saved. Claude Code writes the API types to
`.claude-plugin/types/` the first time it loads the mod; after that:

```sh
claude plugin validate .
claude plugin test .
npx tsc -p .
```

## License

MIT
