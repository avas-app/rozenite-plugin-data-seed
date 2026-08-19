import type { QuerySnapshot, SerializedPayload } from '../shared/types'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'seeded'

/**
 * Renders a query key the way TanStack's own devtools do — as the array
 * literal you would type into `useQuery`, so it can be copied straight back
 * into code.
 */
export function formatKey(queryKey: unknown[]): string {
  try {
    return JSON.stringify(queryKey)
  } catch {
    return String(queryKey)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A one-line summary of a payload, for the collapsed row. */
export function summarize(payload: SerializedPayload | undefined): string {
  if (!payload) return '—'
  switch (payload.kind) {
    case 'undefined':
      return 'no data'
    case 'null':
      return 'null'
    case 'unserializable':
      return `unserializable${payload.note ? ` (${payload.note})` : ''}`
    case 'string':
      return `"${String(payload.value).slice(0, 60)}"`
    case 'number':
    case 'boolean':
      return String(payload.value)
    case 'json': {
      const value = payload.value
      if (Array.isArray(value)) return `Array(${value.length})`
      if (value && typeof value === 'object') {
        const keys = Object.keys(value as object)
        return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`
      }
      return String(value)
    }
    default:
      return '—'
  }
}

export function queryTone(query: QuerySnapshot): Tone {
  if (query.seeded) return 'seeded'
  if (query.status === 'error') return 'danger'
  if (query.fetchStatus === 'fetching') return 'warning'
  if (query.status === 'success') return 'success'
  return 'neutral'
}

export function statusLabel(query: QuerySnapshot): string {
  if (query.fetchStatus === 'fetching') return 'fetching'
  if (query.fetchStatus === 'paused') return 'paused'
  return query.status
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  seeded: 'text-primary',
}

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  seeded: 'bg-primary/10 text-primary',
}

export function toneTextClass(tone: Tone): string {
  return TONE_TEXT[tone]
}

export function toneBadgeClass(tone: Tone): string {
  return TONE_BADGE[tone]
}

/** Case-insensitive substring test that tolerates undefined haystacks. */
export function matches(haystack: string | undefined, needle: string): boolean {
  return Boolean(haystack && haystack.toLowerCase().includes(needle))
}
