import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, SessionRateLimit, ThemeKey } from 'claude-code'

import type { Effort } from '../types'

// Effort is only visible on a model request (turn.step), so it is kept here;
// model, context and rate limits are read live on each draw. `tick` forces a
// redraw: after each turn, and on a timer so reset countdowns stay current.
const effort = atom({ plugin: 'session-band', key: 'effort' } as const, null as Effort | null)
const tick = atom({ plugin: 'session-band', key: 'tick' } as const, 0)
const notice = atom({ plugin: 'session-band', key: 'notice' } as const, null as string | null)
// Per transcript row: how long a tool call took (-1 until it ends), and
// whether a prompt carried images, so its row keeps the engine's drawing of them.
const duration = atom({ plugin: 'session-band', key: 'duration' } as const, -1)
const images = atom({ plugin: 'session-band', key: 'images' } as const, false)
// When each prompt was sent (0 when unknown: one stored before this mod loaded).
const sentAt = atom({ plugin: 'session-band', key: 'sentAt' } as const, 0)

const PANE = 'usage-detail'
const PANE_TITLE = 'Usage and model'
const COMMAND = 'usage-panel'
const REFRESH_MS = 30_000
const BAR_CELLS = 10
const CARD_GAP = 2
const MIN_CARD_COLUMNS = 30

// Theme keys, so cards and pills follow the person's light or dark theme.
const CARD_BG = 'userMessageBackground'
const ACCENT = 'claude'

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const EFFORT_INFO: Record<(typeof EFFORT_LEVELS)[number], { name: string; hint: string }> = {
  low: { name: 'low', hint: 'quick answers, little reasoning' },
  medium: { name: 'medium', hint: 'a balance of speed and care' },
  high: { name: 'high', hint: 'thinks it through, slower' },
  xhigh: { name: 'extra high', hint: 'for hard tasks' },
  max: { name: 'max', hint: 'all the reasoning it can' },
}

// What `/model <alias>` takes, as the picker in the panel offers it.
export const MODEL_CHOICES = [
  { alias: 'opus[1m]', label: 'Opus 1M', family: 'opus', isLong: true },
  { alias: 'opus', label: 'Opus', family: 'opus', isLong: false },
  { alias: 'sonnet', label: 'Sonnet', family: 'sonnet', isLong: false },
  { alias: 'haiku', label: 'Haiku', family: 'haiku', isLong: false },
  { alias: 'fable', label: 'Fable', family: 'fable', isLong: false },
] as const

const WINDOWS: Record<string, { title: string; subtitle: string }> = {
  five_hour: { title: 'Session', subtitle: '5-hour window' },
  seven_day: { title: 'Week', subtitle: '7-day window' },
  spend_limit: { title: 'Spend', subtitle: 'spend limit' },
}

type Tone = 'success' | 'warning' | 'error'

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function prettyModel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/i.exec(model)
  if (!match) return model
  const [, family = '', major, minor, isLong] = match
  const name = `${family[0]?.toUpperCase() ?? ''}${family.slice(1)} ${major}.${minor}`
  return isLong ? `${name} · 1M` : name
}

export function isActiveChoice(model: string, choice: (typeof MODEL_CHOICES)[number]): boolean {
  const lower = model.toLowerCase()
  return lower.includes(choice.family) && lower.endsWith('[1m]') === choice.isLong
}

export function fill(percent: number, cells = BAR_CELLS): [string, string] {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return ['█'.repeat(filled), '░'.repeat(cells - filled)]
}

export function bar(percent: number, cells = BAR_CELLS): string {
  return fill(percent, cells).join('')
}

function tone(percent: number): Tone {
  if (percent >= 80) return 'error'
  if (percent >= 50) return 'warning'
  return 'success'
}

export function formatCountdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function formatReset(resetsAt: number, now: number): string {
  const time = timeFormat.format(resetsAt)
  const sameDay = new Date(resetsAt).toDateString() === new Date(now).toDateString()
  return sameDay ? `today at ${time}` : `${dayFormat.format(resetsAt)} at ${time}`
}

// How many cards fit side by side, and how wide each is.
export function cardLayout(columns: number, count: number): { perRow: number; width: number } {
  const perRow = Math.max(
    1,
    Math.min(count, Math.floor((columns + CARD_GAP) / (MIN_CARD_COLUMNS + CARD_GAP))),
  )
  return { perRow, width: Math.floor((columns - CARD_GAP * (perRow - 1)) / perRow) }
}

// Transcript rows: each tool call gets an icon and a label for its kind, then
// the call itself.
export type ToolKind = 'run' | 'read' | 'edit' | 'write' | 'search' | 'web' | 'mcp'

const KINDS: Record<ToolKind, { icon: string; label: string }> = {
  run: { icon: '$', label: 'Run' },
  read: { icon: '≡', label: 'Read' },
  edit: { icon: '✎', label: 'Edit' },
  write: { icon: '✚', label: 'Write' },
  search: { icon: '⌕', label: 'Search' },
  web: { icon: '⊕', label: 'Web' },
  mcp: { icon: '◇', label: 'MCP' },
}

const BUILTIN_KINDS: Record<string, ToolKind> = {
  Bash: 'run',
  PowerShell: 'run',
  Read: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
  Glob: 'search',
  Grep: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
}

// Only a person's own typing gets the prompt outline: a task notification or
// another agent's message is not theirs to dress as theirs.
const TYPED_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const MAX_PROMPT = 4000
const MAX_TARGET = 120

// Null leaves the row to the engine: agents, todos and plan mode draw live
// progress and dialogs of their own.
export function kindOf(tool: string): ToolKind | null {
  if (tool.startsWith('mcp__')) return 'mcp'
  return BUILTIN_KINDS[tool] ?? null
}

const fieldsOf = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')
const oneLine = (text: string): string => (text.split('\n', 1)[0] ?? '').replace(/\s+/g, ' ').trim()

export function shortenPath(path: string, cwd: string): string {
  const root = cwd.replace(/\/+$/, '')
  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

// The one thing about a call worth a glance: the command, the file, the pattern.
export function summarize(tool: string, input: unknown, cwd: string): string {
  const fields = fieldsOf(input)
  const summary = (() => {
    switch (tool) {
      case 'Bash':
      case 'PowerShell':
        return textOf(fields.command)
      case 'Read':
      case 'Edit':
      case 'MultiEdit':
      case 'Write':
        return shortenPath(textOf(fields.file_path), cwd)
      case 'NotebookEdit':
        return shortenPath(textOf(fields.notebook_path), cwd)
      case 'Glob':
        return textOf(fields.pattern)
      case 'Grep': {
        const where = textOf(fields.path)
        return where === ''
          ? textOf(fields.pattern)
          : `${textOf(fields.pattern)} in ${shortenPath(where, cwd)}`
      }
      case 'WebFetch':
        return textOf(fields.url).replace(/^https?:\/\//, '')
      case 'WebSearch':
        return textOf(fields.query)
      default: {
        return Object.values(fields).map(textOf).find(v => v !== '') ?? ''
      }
    }
  })()
  return oneLine(summary).slice(0, MAX_TARGET)
}

// `mcp__github__search_code` reads as `github:search_code`; a built-in keeps its name.
export function toolName(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool
  const [, server = '', ...name] = tool.split('__')
  return `${server}:${name.join('__')}`
}

// Lines added and removed, read from an Edit or Write record's patch.
export function diffstat(output: unknown): { added: number; removed: number } | null {
  const patch = (output as { structuredPatch?: unknown } | null)?.structuredPatch
  if (!Array.isArray(patch)) return null
  const lines = patch.flatMap(hunk => {
    const hunkLines = (hunk as { lines?: unknown } | null)?.lines
    return Array.isArray(hunkLines) ? hunkLines.filter(l => typeof l === 'string') : []
  }) as string[]
  return {
    added: lines.filter(l => l.startsWith('+')).length,
    removed: lines.filter(l => l.startsWith('-')).length,
  }
}

// A tool call's own time: `340ms`, `2.1s`, `1m 4s`.
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

type CallState = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

// The worst thing that happened to any of the calls, else how far along they are.
function status(calls: readonly CallState[]): { glyph: string; color: ThemeKey } {
  if (calls.some(c => c.isInterrupted)) return { glyph: '◌', color: 'warning' }
  if (calls.some(c => c.isErrored)) return { glyph: '✕', color: 'error' }
  if (calls.some(c => c.isRunning)) return { glyph: '○', color: 'inactive' }
  return { glyph: '●', color: 'success' }
}

const OTHER = { icon: '·', label: 'Other' }
const MAX_GROUP_ROWS = 6

type RowUi = Pick<ElementTable, 'Box' | 'Text'>
type RowCall = CallState & { tool: string; input: unknown }

// The rail ties a turn's calls into one line down the left, as skins draws it.
const RAIL = '┃'
const BRANCH = '─'
const RAIL_COLOR: ThemeKey = 'inactive'

// One call's row in the skins style: the rail above, then
// `●─ $ Run  npm test` with its facts flush right.
function callRow(
  { Box, Text }: RowUi,
  call: RowCall,
  cwd: string,
  facts: { ms: number; diff: { added: number; removed: number } | null },
) {
  const kind = kindOf(call.tool)
  const { icon, label } = kind === null ? OTHER : KINDS[kind]
  const { glyph, color: statusColor } = status([call])
  const summary = summarize(call.tool, call.input, cwd)
  // A built-in's label says what it is; an MCP or unknown tool names itself.
  const target = kind === 'mcp' || kind === null ? `${toolName(call.tool)}  ${summary}` : summary

  const meta = []
  if (facts.diff !== null && facts.diff.added + facts.diff.removed > 0) {
    meta.push(<Text color="diffAdded">{`+${facts.diff.added}`}</Text>)
    meta.push(<Text color="diffRemoved">{` −${facts.diff.removed}`}</Text>)
  }
  if (facts.ms >= 0 && !call.isRunning) {
    meta.push(<Text dimColor>{`${meta.length > 0 ? '  ' : ''}${formatMs(facts.ms)}`}</Text>)
  }

  const main = (
    <Text wrap="truncate-end">
      <Text color={statusColor}>
        {glyph}
        <Text dimColor>{`${BRANCH} `}</Text>
      </Text>
      <Text color="text" bold>
        {`${icon} ${label}`}
      </Text>
      <Text color={call.isErrored ? 'error' : undefined} dimColor={!call.isErrored}>
        {`  ${target}`}
      </Text>
      {call.isInterrupted ? <Text color="warning">{'  · interrupted'}</Text> : null}
    </Text>
  )

  return (
    <Box flexDirection="column">
      <Text color={RAIL_COLOR}>{RAIL}</Text>
      {meta.length === 0 ? (
        main
      ) : (
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            {main}
          </Box>
          <Box flexShrink={0} paddingLeft={2}>
            <Text>{meta}</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// Long Bash output keeps its first `head` and last `tail` lines and names
// how many it hid; the stored result, and what the model read, are untouched.
const CLIP_HEAD = 8
const CLIP_TAIL = 4

export function clipLines(text: string, head = CLIP_HEAD, tail = CLIP_TAIL): string {
  const lines = text.split('\n')
  const hidden = lines.length - head - tail
  if (hidden <= 1) return text
  return [...lines.slice(0, head), `… ${hidden} lines hidden`, ...lines.slice(-tail)].join('\n')
}

async function openPanel($: EngineInterface) {
  await update($, notice, () => null)
  return $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
}

async function runCommand($: EngineInterface, command: string, args: string, done: string) {
  await update($, notice, () => `/${command} ${args}…`)
  try {
    const result = await $.command.run({ command, args })
    await update($, notice, () => result.text?.trim() || done)
  } catch (error) {
    await update($, notice, () => `/${command} failed: ${String(error)}`)
  }
  await update($, tick, n => n + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(REFRESH_MS, () => {
      void update($, tick, n => n + 1)
    })
    await $.command.register({
      name: COMMAND,
      description: 'Open the usage detail, with quick model and effort switches',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openPanel($)

    return { text: `${PANE_TITLE}: panel open.` }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const current = e.effort ?? null
      if ((await read($, effort)) !== current) {
        await update($, effort, () => current)
      }
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await update($, tick, n => n + 1)

    return result
  })

  // Times every call, for the right edge of its row.
  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const ms = (await $.clock.now()) - startedAt
    await update($, memberOf(duration, { requestId: e.tool_use_id }), () => ms)

    return ran
  }).catch(($, e, next) => next(e))

  // Notes when each prompt was sent, for its header, and which carried images,
  // so their row keeps the engine's drawing of them.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'prompt' && stored.uuid !== undefined) {
      const now = await $.clock.now()
      await update($, memberOf(sentAt, { requestId: stored.uuid }), () => now)
      if (e.message.content.some(block => block.type === 'image')) {
        await update($, memberOf(images, { requestId: stored.uuid }), () => true)
      }
    }

    return stored
  }).catch(($, e, next) => next(e))

  // Your prompt in a rounded outline sized to what you typed, with a small
  // header, so it stands apart from the replies.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!TYPED_ORIGINS.has(e.props.origin.kind) || e.props.text.length > MAX_PROMPT) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const hasImages = await read($, memberOf(images, e))
    const sent = await read($, memberOf(sentAt, e))
    // The engine draws the images; the text is already in the outline above them.
    const theirImages = hasImages ? await next({ ...e, props: { ...e.props, text: '' } }) : null

    return (
      <Box flexDirection="column" alignItems="flex-start" marginTop={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="promptBorder"
          paddingX={1}
          flexShrink={1}
        >
          <Text>
            <Text color={ACCENT} bold>
              {'❯ You'}
            </Text>
            {sent > 0 ? <Text dimColor>{` · ${timeFormat.format(sent)}`}</Text> : null}
          </Text>
          <Text>{e.props.text}</Text>
        </Box>
        {theirImages}
      </Box>
    )
  })

  // A tool call: status, icon and label in its kind's colour, the call itself
  // (`Bash(npm test)`), and lines changed and time taken at the right edge.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (kindOf(e.props.tool) === null) return next(e)

    return callRow($.ui.resolve(e), e.props, await $.session.cwd(), {
      ms: await read($, memberOf(duration, e)),
      diff: diffstat(e.props.output),
    })
  })

  // A folded run of reads and searches: one row per call, so every command
  // shows without opening the group; past MAX_GROUP_ROWS a count of the rest.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)

    const ui = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const shown = e.props.calls.slice(0, MAX_GROUP_ROWS)
    const hidden = e.props.calls.length - shown.length
    const rows = await Promise.all(
      shown.map(async call =>
        callRow(ui, call, cwd, {
          ms:
            call.tool_use_id === undefined
              ? -1
              : await read($, memberOf(duration, { requestId: call.tool_use_id })),
          diff: null,
        }),
      ),
    )

    return (
      <ui.Box flexDirection="column">
        {rows}
        {hidden > 0 ? <ui.Text dimColor>{`┃\n   … +${hidden} more`}</ui.Text> : null}
      </ui.Box>
    )
  })

  // A long Bash output, cut to its head and tail in the transcript.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const output = e.props.output as { stdout?: unknown } | null
    if (e.props.tool !== 'Bash' || typeof output?.stdout !== 'string') return next(e)

    const stdout = clipLines(output.stdout)
    return stdout === output.stdout
      ? next(e)
      : next({ ...e, props: { ...e.props, output: { ...output, stdout } } })
  })

  // Under the prompt: the engine's own hint line with the chips beside it and
  // the button that opens the panel pinned to the right end; on a narrow
  // terminal the chips wrap to the next row.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    await read($, tick)
    const [model, usage, level, now] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      read($, effort),
      $.clock.now(),
    ])
    const { tokens, window, percent } = usage.context
    const { Box, Button, Text } = $.ui.resolve(e)
    const [full, empty] = fill(percent ?? 0)
    const rank = typeof level === 'string' ? EFFORT_LEVELS.indexOf(level) + 1 : 0
    const session = usage.rateLimits.find(limit => limit.kind === 'five_hour')
    const sessionResetsAt = session?.resetsAt === undefined ? NaN : Date.parse(session.resetsAt)

    return (
      // No width on this Box: the engine refuses its own node (`hint`) under a
      // sized Box and draws its plain line instead.
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        {hint}
        <Box key="row" flexGrow={1} columnGap={2} alignItems="center">
          <Box flexGrow={1} flexShrink={1} flexWrap="wrap" columnGap={2}>
            <Box backgroundColor={ACCENT} paddingX={1}>
              <Text color="inverseText" bold>
                {prettyModel(model)}
              </Text>
            </Box>
            <Box backgroundColor={CARD_BG} paddingX={1}>
              <Text dimColor>effort </Text>
              {typeof level === 'string' ? (
                <Text>
                  <Text color={ACCENT}>{'●'.repeat(rank)}</Text>
                  <Text dimColor>{'○'.repeat(EFFORT_LEVELS.length - rank)}</Text>
                  <Text bold> {level}</Text>
                </Text>
              ) : (
                <Text bold>{level === null ? '—' : String(level)}</Text>
              )}
            </Box>
            <Box backgroundColor={CARD_BG} paddingX={1}>
              <Text dimColor>context </Text>
              {percent === undefined ? (
                <Text dimColor>waiting · {formatTokens(window)}</Text>
              ) : (
                <Text>
                  <Text color={tone(percent)}>{full}</Text>
                  <Text dimColor>{empty}</Text>
                  <Text color={tone(percent)} bold>
                    {` ${percent}%`}
                  </Text>
                  <Text dimColor>{` · ${formatTokens(tokens ?? 0)}/${formatTokens(window)}`}</Text>
                </Text>
              )}
            </Box>
            {session === undefined ? null : (
              <Box backgroundColor={CARD_BG} paddingX={1}>
                <Text dimColor>5h </Text>
                <Text>
                  <Text color={tone(session.percentUsed)}>{fill(session.percentUsed)[0]}</Text>
                  <Text dimColor>{fill(session.percentUsed)[1]}</Text>
                  <Text color={tone(session.percentUsed)} bold>
                    {` ${Math.round(session.percentUsed)}%`}
                  </Text>
                  {Number.isNaN(sessionResetsAt) ? null : (
                    <Text dimColor>{` · ↻ ${formatCountdown(sessionResetsAt - now)}`}</Text>
                  )}
                </Text>
              </Box>
            )}
          </Box>
          <Box flexShrink={0}>
            <Button key="open-usage" label="Usage ▸" onPress={() => void openPanel($)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const [model, usage, level, message, now, commands] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      read($, effort),
      read($, notice),
      $.clock.now(),
      $.command.list(),
    ])
    const hasEffortCommand = commands.some(c => c.name === 'effort')
    const { tokens, window, percent } = usage.context
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = Math.max(MIN_CARD_COLUMNS, e.props.bodyColumns - 2)

    const meter = (value: number, cells: number) => {
      const [full, empty] = fill(value, cells)
      return (
        <Text>
          <Text color={tone(value)}>{full}</Text>
          <Text dimColor>{empty}</Text>
        </Text>
      )
    }

    // One card: a tinted block with a small label, a big figure, a bar and
    // two lines of detail.
    const card = (
      key: string,
      width: number,
      body: {
        label: string
        figure: string
        figureTone: Tone | typeof ACCENT
        caption?: string
        percent?: number
        lines: JSX.Element[]
      },
    ) => (
      <Box
        key={key}
        width={width}
        flexDirection="column"
        backgroundColor={CARD_BG}
        paddingX={2}
        paddingY={1}
        marginBottom={1}
      >
        <Text dimColor>{body.label.toUpperCase()}</Text>
        <Text>
          <Text color={body.figureTone} bold>
            {body.figure}
          </Text>
          {body.caption === undefined ? null : <Text dimColor>{`  ${body.caption}`}</Text>}
        </Text>
        {body.percent === undefined ? null : meter(body.percent, Math.max(8, width - 4))}
        {body.lines}
      </Box>
    )

    const limitCard = (limit: SessionRateLimit, width: number) => {
      const info = WINDOWS[limit.kind] ?? { title: limit.kind, subtitle: '' }
      const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
      const left = Math.max(0, Math.round(100 - limit.percentUsed))
      return card(`limit-${limit.kind}`, width, {
        label: `${info.title} · ${info.subtitle}`,
        figure: `${Math.round(limit.percentUsed)}%`,
        figureTone: tone(limit.percentUsed),
        caption: `used · ${left}% left`,
        percent: limit.percentUsed,
        lines: Number.isNaN(resetsAt)
          ? [<Text dimColor>Reset time not available</Text>]
          : [
              <Text>
                <Text dimColor>{'↻ '}</Text>
                <Text>{formatReset(resetsAt, now)}</Text>
              </Text>,
              <Text>
                <Text dimColor>{'  in '}</Text>
                <Text color={ACCENT} bold>
                  {formatCountdown(resetsAt - now)}
                </Text>
              </Text>,
            ],
      })
    }

    const contextCard = (width: number) =>
      card('context', width, {
        label: 'Context · model window',
        figure: percent === undefined ? '—' : `${percent}%`,
        figureTone: percent === undefined ? ACCENT : tone(percent),
        caption: percent === undefined ? 'waiting for the first reply' : 'used',
        percent,
        lines: [
          <Text dimColor>{`${formatTokens(tokens ?? 0)} of ${formatTokens(window)} tokens`}</Text>,
          <Text dimColor>
            {usage.cost === undefined ? ' ' : `session cost $${usage.cost.usd.toFixed(2)}`}
          </Text>,
        ],
      })

    const cardCount = usage.rateLimits.length + 1
    const { width: cardWidth } = cardLayout(columns, cardCount)

    // A segmented control: one pill per option, the active one filled.
    const pill = (key: string, label: string, isActive: boolean, onPress: () => void) => (
      <Box
        key={`pill-${key}`}
        backgroundColor={isActive ? ACCENT : CARD_BG}
        hover={{ backgroundColor: isActive ? ACCENT : 'promptBorder' }}
        paddingX={1}
      >
        <Button key={key} label={label} plain onPress={onPress} />
      </Box>
    )

    const effortName =
      typeof level === 'string' ? EFFORT_INFO[level].name : level === null ? '—' : String(level)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text>
            <Text color={ACCENT} bold>
              {'◆ '}
            </Text>
            <Text bold>Plan usage</Text>
          </Text>
          <Text dimColor>updates live · esc closes</Text>
        </Box>

        {usage.rateLimits.length === 0 ? (
          <Box marginBottom={1}>
            <Text dimColor>
              The 5-hour and weekly limits show after the model's first reply (Claude
              subscriptions only).
            </Text>
          </Box>
        ) : null}
        <Box flexWrap="wrap" columnGap={CARD_GAP}>
          {usage.rateLimits.map(limit => limitCard(limit, cardWidth))}
          {contextCard(cardWidth)}
        </Box>

        <Box
          flexDirection="column"
          backgroundColor={CARD_BG}
          paddingX={2}
          paddingY={1}
          marginBottom={1}
        >
          <Text dimColor>MODEL</Text>
          <Text>
            <Text bold>{prettyModel(model)}</Text>
            <Text dimColor>{'  active now · a change applies from the next message'}</Text>
          </Text>
          <Box flexWrap="wrap" columnGap={1} marginTop={1}>
            {MODEL_CHOICES.map(choice =>
              pill(`model-${choice.alias}`, choice.label, isActiveChoice(model, choice), () => {
                void runCommand($, 'model', choice.alias, `Model set: ${choice.label}`)
              }),
            )}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>EFFORT</Text>
          </Box>
          <Text>
            <Text bold>{effortName}</Text>
            <Text dimColor>
              {typeof level === 'string'
                ? `  ${EFFORT_INFO[level].hint}`
                : '  known after the first prompt'}
            </Text>
          </Text>
          {hasEffortCommand ? (
            <Box flexWrap="wrap" columnGap={1} marginTop={1}>
              {EFFORT_LEVELS.map(value =>
                pill(`effort-${value}`, EFFORT_INFO[value].name, level === value, () => {
                  void (async () => {
                    await runCommand($, 'effort', value, `Effort set: ${value}`)
                    await update($, effort, () => value)
                  })()
                }),
              )}
            </Box>
          ) : (
            <Text dimColor>/effort is not available in this Claude Code version</Text>
          )}
        </Box>

        <Box justifyContent="space-between">
          <Text color="suggestion">{message ?? ' '}</Text>
          <Button
            key="close"
            label="Close"
            role="dismiss"
            onPress={() => void $.ui.close({ id: PANE })}
          />
        </Box>
      </Box>
    )
  })
}
