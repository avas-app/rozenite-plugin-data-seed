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

import axios from 'axios'
import { fetch as expoFetch } from 'expo/fetch'
import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'

/** Generic envelope, as most real APIs have. */
export type ApiResponse<T> = {
  data: T
  meta: { requestId: string; durationMs: number }
}

export type Todo = {
  id: number
  /** @faker lorem.sentence */
  title: string
  done: boolean
  /** @faker date.recent */
  createdAt: string
}

export type User = {
  /** @faker number.int({min: 1, max: 9999}) */
  id: number
  /** @faker person.fullName */
  name: string
  /** @faker internet.email */
  email: string
  /** @faker image.avatar */
  avatarUrl: string
  /** @faker date.past */
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
  /** @faker internet.userName */
  author: string
  /** @faker lorem.paragraph */
  body: string
  /** @faker date.recent */
  createdAt: string
  replies: Comment[]
}

/**
 * The three shapes that arrive over real networking, one per transport.
 *
 * Everything else here is a fake resolved in-process; these deliberately are
 * not, because an adapter that patches the network has nothing to intercept
 * unless something actually calls it. React Native has three separate paths and
 * the plugin reaches them in three different ways, so the example exercises all
 * three rather than asserting they work:
 *
 *   Profile  — `globalThis.fetch`, patched for you
 *   Order    — axios, which uses `XMLHttpRequest` directly
 *   Invoice  — `expo/fetch`, native, wrapped by hand with `seedableFetch`
 */
export type Profile = {
  /** @faker person.fullName */
  name: string
  /** @faker internet.email */
  email: string
  /** @faker number.int({min: 0, max: 50000}) */
  followers: number
  /** @faker date.past */
  joinedAt: string
}

export type Order = {
  /** @faker string.uuid */
  id: string
  /** @faker number.float({min: 5, max: 500}) */
  total: number
  status: 'pending' | 'shipped' | 'delivered'
  /** @faker date.recent */
  placedAt: string
}

export type Invoice = {
  /** @faker string.alpha({length: 8}) */
  number: string
  /** @faker number.float({min: 20, max: 2000}) */
  amountDue: number
  /** @faker date.soon */
  dueAt: string
  paid: boolean
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

/**
 * Points at a host that cannot resolve, on purpose.
 *
 * `.invalid` is reserved by RFC 2606 and is guaranteed never to exist, so this
 * request always fails — which makes it the clearest possible demonstration:
 * the card is broken until you seed `GET /v1/profile` in the panel, and then it
 * renders, with no server involved at either point.
 */
export const PROFILE_URL = 'https://api.example.invalid/v1/profile'

export const ORDERS_URL = 'https://api.example.invalid/v1/orders'
export const INVOICE_URL = 'https://api.example.invalid/v1/invoice'

/** Plain `globalThis.fetch` — covered by `http: true` with no extra wiring. */
export async function fetchProfile(): Promise<Profile> {
  const response = await fetch(PROFILE_URL)
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return (await response.json()) as Profile
}

/** axios, which talks to `XMLHttpRequest` and never touches `fetch`. */
export async function fetchOrders(): Promise<Order[]> {
  const { data } = await axios.get<Order[]>(ORDERS_URL)
  return data
}

/**
 * `expo/fetch`, which is native — it goes through neither `globalThis.fetch`
 * nor `XMLHttpRequest`, and its module export cannot be replaced (Metro
 * compiles the re-export to a getter with `configurable: false`). So it is
 * wrapped explicitly, once, here at the import site.
 *
 * The wrapper is inert outside `__DEV__`, so this line costs a function call in
 * production and nothing else.
 */
const netFetch = seedableFetch(expoFetch)

export async function fetchInvoice(): Promise<Invoice> {
  const response = await netFetch(INVOICE_URL)
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return (await response.json()) as Invoice
}

function iso(daysAgo: number): string {
  return new Date(Date.now() + daysAgo * 86_400_000).toISOString()
}
