/**
 * A fake API for the example app.
 *
 * There is no network, no API key, and no account — which is the point. The
 * plugin exists so you do not have to manufacture a real backend state just to
 * see a screen render, and an example that required one would be arguing
 * against itself.
 *
 * The types below are deliberately hostile. Each one is a shape that breaks a
 * naive TypeScript-to-JSON-Schema extraction, and they live here from day one
 * so the generator that comes later has something real to fail against:
 *
 *   1. `ApiResponse<T>`  — a generic wrapper; extraction needs a concrete
 *                          instantiation per query, not the generic itself.
 *   2. `Settings.flags`  — an `any` leak; nothing to generate from, and the
 *                          single most common hole in a real codebase.
 *   3. `Comment`         — self-recursive; needs a depth cap or it never ends.
 *   4. `Notification`    — a discriminated union; a generator has to be told
 *                          which variant to emit or it picks arbitrarily.
 *   5. `*.createdAt`     — an ISO date carried as `string`, indistinguishable
 *                          from any other string without an annotation.
 */

/** Generic envelope, as most real APIs have. */
export type ApiResponse<T> = {
  data: T
  meta: { requestId: string; durationMs: number }
}

export type Todo = {
  id: number
  title: string
  done: boolean
  /** @faker date.recent → iso */
  createdAt: string
}

export type User = {
  id: number
  /** @faker person.fullName */
  name: string
  /** @faker internet.email */
  email: string
  /** @faker image.avatar */
  avatarUrl: string
  /** @faker date.past → iso */
  createdAt: string
}

export type Settings = {
  theme: 'light' | 'dark' | 'system'
  /** Intentional `any`: feature flags arrive untyped from the server. */
  flags: any
}

/** Self-recursive: a comment thread of unbounded depth. */
export type Comment = {
  id: number
  author: string
  body: string
  /** @faker date.recent → iso */
  createdAt: string
  replies: Comment[]
}

/** Discriminated union: the generator must be told which arm to produce. */
export type Notification =
  | { kind: 'mention'; id: number; from: string; commentId: number }
  | { kind: 'system'; id: number; severity: 'info' | 'warn'; message: string }
  | { kind: 'digest'; id: number; period: 'daily' | 'weekly'; count: number }

const LATENCY_MS = 400

function respond<T>(data: T): Promise<ApiResponse<T>> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          data,
          meta: { requestId: `req_${counter++}`, durationMs: LATENCY_MS },
        }),
      LATENCY_MS,
    ),
  )
}

let counter = 1

/**
 * Flipped by the example's "break the API" button, so you can watch a seed
 * hold a screen together while the backend behind it is failing.
 */
let failing = false

export function setFailing(next: boolean): void {
  failing = next
}

export function isFailing(): boolean {
  return failing
}

function guard(): void {
  if (failing) throw new Error('Request failed with status 500')
}

export async function fetchTodos(): Promise<ApiResponse<Todo[]>> {
  guard()
  return respond([
    { id: 1, title: 'Wire up the bridge', done: true, createdAt: iso(-3) },
    { id: 2, title: 'Ship the transport slice', done: false, createdAt: iso(-1) },
  ])
}

export async function fetchUser(id: number): Promise<ApiResponse<User>> {
  guard()
  return respond({
    id,
    name: 'Real Account',
    email: 'real@example.com',
    avatarUrl: 'https://example.com/avatar.png',
    createdAt: iso(-90),
  })
}

export async function fetchSettings(): Promise<ApiResponse<Settings>> {
  guard()
  return respond({ theme: 'system' as const, flags: { beta: true } })
}

export async function fetchThread(id: number): Promise<ApiResponse<Comment>> {
  guard()
  return respond({
    id,
    author: 'ada',
    body: 'Top-level comment',
    createdAt: iso(-2),
    replies: [
      {
        id: id + 1,
        author: 'grace',
        body: 'A reply',
        createdAt: iso(-1),
        replies: [],
      },
    ],
  })
}

export async function fetchNotifications(): Promise<ApiResponse<Notification[]>> {
  guard()
  return respond([
    { kind: 'mention', id: 1, from: 'ada', commentId: 42 },
    { kind: 'system', id: 2, severity: 'info', message: 'Scheduled maintenance' },
  ])
}

function iso(daysAgo: number): string {
  return new Date(Date.now() + daysAgo * 86_400_000).toISOString()
}
