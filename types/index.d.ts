export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number

declare module 'claude-code' {
  interface PluginState {
    'session-band': {
      effort: Effort | null
      tick: number
      notice: string | null
      duration: StateFamily<number>
      images: StateFamily<boolean>
      sentAt: StateFamily<number>
    }
  }
}
