import { expect, test } from 'claude-code/testing'

import {
  MODEL_CHOICES,
  bar,
  formatCountdown,
  formatReset,
  formatTokens,
  isActiveChoice,
  cardLayout,
  clipLines,
  diffstat,
  formatMs,
  kindOf,
  summarize,
  toolName,
  prettyModel,
} from './register'

// 2026-10-07 14:00 Europe/Rome
const NOW = Date.UTC(2026, 9, 7, 12, 0)

const USAGE = {
  startedAt: 0,
  context: { tokens: 250_000, window: 1_000_000, percent: 25 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(NOW + 133 * 60_000).toISOString() },
    {
      kind: 'seven_day',
      percentUsed: 81.5,
      resetsAt: new Date(NOW + 117 * 3_600_000).toISOString(),
    },
  ],
  cost: { usd: 1.234 },
}

test('formats tokens, bars, model names and countdowns', async () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(42_300)).toBe('42k')
  expect(formatTokens(1_000_000)).toBe('1M')
  expect(bar(0)).toBe('░░░░░░░░░░')
  expect(bar(45)).toBe('█████░░░░░')
  expect(bar(100)).toBe('██████████')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 · 1M')
  expect(prettyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(prettyModel('custom-model')).toBe('custom-model')
  expect(formatCountdown(47 * 60_000)).toBe('47m')
  expect(formatCountdown((2 * 60 + 5) * 60_000)).toBe('2h 05m')
  expect(formatCountdown((5 * 24 + 21) * 3_600_000)).toBe('5d 21h')
})

test('reset time reads in plain words, local time', async () => {
  expect(formatReset(NOW + 2 * 3_600_000, NOW)).toBe('today at 16:00')
  expect(formatReset(NOW + 5 * 24 * 3_600_000, NOW)).toBe('Monday 12 October at 14:00')
})

test('the active model choice follows the session model', async () => {
  const active = MODEL_CHOICES.filter(c => isActiveChoice('claude-opus-5-5[1m]', c))
  expect(active.map(c => c.alias)).toEqual(['opus[1m]'])
  const sonnet = MODEL_CHOICES.filter(c => isActiveChoice('claude-sonnet-5-5', c))
  expect(sonnet.map(c => c.alias)).toEqual(['sonnet'])
})

test('the row under the prompt keeps the hint, shows the summary and opens the panel', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'session-band',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5 · 1M/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /250k\/1M/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' 42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · ↻ 2h 13m' })).toBeDefined()
    await ui.press({ key: 'open-usage' })
    await ui.unmount()
  }
  expect(opened).toEqual(['usage-detail', 'usage-detail'])
})

test('the panel details usage and switches model and effort', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('command.list', () => ({
    value: [
      { name: 'model', description: '', source: 'builtin' as const },
      { name: 'effort', description: '', source: 'builtin' as const },
    ],
  }))
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(`/${e.command} ${e.args}`)
    return { text: `ok ${e.args}` }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'session-band',
      surface,
      component: 'Pane',
      requestId: 'usage-detail',
      props: {
        title: 'Usage and model',
        isFocused: true,
        bodyColumns: 100,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: 'SESSION · 5-HOUR WINDOW' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'today at 16:13' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2h 13m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Monday 12 October at 11:00' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /58% left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()

    await ui.press({ key: 'model-sonnet' })
    await ui.press({ key: 'effort-high' })
    expect(await ui.find({ type: 'Text', text: 'high' })).toBeDefined()
    await ui.unmount()
  }
  expect(ran).toEqual(['/model sonnet', '/effort high', '/model sonnet', '/effort high'])
})

test('cards sit side by side when there is room, stacked when not', async () => {
  expect(cardLayout(100, 3)).toEqual({ perRow: 3, width: 32 })
  expect(cardLayout(70, 3)).toEqual({ perRow: 2, width: 34 })
  expect(cardLayout(40, 3)).toEqual({ perRow: 1, width: 40 })
})

test('tool calls are sorted into kinds and summarized', async () => {
  expect(kindOf('Bash')).toBe('run')
  expect(kindOf('Read')).toBe('read')
  expect(kindOf('Edit')).toBe('edit')
  expect(kindOf('Write')).toBe('write')
  expect(kindOf('Grep')).toBe('search')
  expect(kindOf('mcp__github__search_code')).toBe('mcp')
  expect(kindOf('Agent')).toBe(null)
  expect(summarize('Read', { file_path: '/repo/src/app.ts' }, '/repo')).toBe('src/app.ts')
  expect(summarize('Bash', { command: 'npm test\n--watch' }, '/repo')).toBe('npm test')
  expect(summarize('Grep', { pattern: 'TODO', path: '/repo/src' }, '/repo')).toBe('TODO in src')
  expect(summarize('mcp__github__search_code', { q: 'x' }, '/repo')).toBe('x')
  expect(toolName('mcp__github__search_code')).toBe('github:search_code')
  expect(toolName('Bash')).toBe('Bash')
  expect(diffstat({ structuredPatch: [{ lines: ['+a', '+b', '-c', ' d'] }] })).toEqual({ added: 2, removed: 1 })
  expect(diffstat(undefined)).toBe(null)
  expect(formatMs(340)).toBe('340ms')
  expect(formatMs(2100)).toBe('2.1s')
  expect(formatMs(64_000)).toBe('1m 4s')
})

test('a tool row shows icon, verb, target and time', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'session-band',
      surface,
      component: 'ToolUse',
      props: {
        tool_use_id: 't1',
        tool: 'Edit',
        input: { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: { structuredPatch: [{ lines: ['+x', '-y'] }] },
      },
    })
    expect(await ui.find({ type: 'Text', text: /✎ Edit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  src/app.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+1' })).toBeDefined()
    await ui.unmount()
  }
})

test('your prompt gets its outline; a notification keeps the engine row', async ($, on) => {
  const ui = await $.ui.mount({
    plugin: 'session-band',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'ciao Claude', origin: { kind: 'composer' }, isExpanded: true },
  })
  expect(await ui.find({ type: 'Text', text: '❯ You' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ciao Claude' })).toBeDefined()
  await ui.unmount()
})

test('a folded group shows each command, not a count', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  const call = (command: string) => ({
    tool: 'Bash',
    input: { command },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  })
  const ui = await $.ui.mount({
    plugin: 'session-band',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [call('ls -la'), ...Array.from({ length: 7 }, (_, i) => call(`cat f${i}`))],
      isActive: false,
      isExpanded: false,
    },
  })
  expect(await ui.find({ type: 'Text', text: '  ls -la' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$ Run/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /… \+2 more/ })).toBeDefined()
  await ui.unmount()
})

test('long Bash output keeps its head and tail', async () => {
  const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const clipped = clipLines(text).split('\n')
  expect(clipped.length).toBe(13)
  expect(clipped[7]).toBe('line 7')
  expect(clipped[8]).toBe('… 18 lines hidden')
  expect(clipped[12]).toBe('line 29')
  expect(clipLines('a\nb\nc')).toBe('a\nb\nc')
})
