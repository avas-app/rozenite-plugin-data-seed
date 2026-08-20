import { useCallback, useEffect, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useSeeder } from '@avasapp/rozenite-plugin-data-seed'

import type { Invoice, Order, Profile } from './api'
import {
  fetchInvoice,
  fetchNotifications,
  fetchOrders,
  fetchProfile,
  fetchSettings,
  fetchThread,
  fetchTodos,
  fetchUser,
  isFailing,
  setFailing,
} from './api'

/**
 * Example app for `@avasapp/rozenite-plugin-data-seed`.
 *
 * Most of the API here is a fake — realistic shapes, realistic latency, no
 * network and no account. Everything else is real: a real `QueryClient`, real
 * `useQuery` calls, the actual `useSeeder` hook and the actual Rozenite bridge,
 * so what the panel does here is what it does in a production app.
 *
 * Run it, press `j` to open React Native DevTools, and pick the **Data Seed**
 * tab. Two things worth trying:
 *
 *   - Seed `["todos"]`, then hit "Break the API" — the screen keeps rendering
 *     your data while every real request behind it fails.
 *   - The last three cards call a host that cannot resolve, so they start
 *     broken by construction — one per networking path React Native has:
 *     `fetch`, axios over `XMLHttpRequest`, and native `expo/fetch`. Seed
 *     `GET /v1/profile`, `GET /v1/orders` or `GET /v1/invoice` and they render,
 *     with no server at either end. Set the status to 503 to break them again.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    // Short but non-zero, so refetches are frequent enough to prove a seed
    // actually survives them rather than merely being written once.
    queries: { staleTime: 5_000, retry: 1 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  )
}

function Root() {
  const isDark = useColorScheme() === 'dark'
  const theme = isDark ? dark : light

  // The only lines an app needs. `require.context` is what makes the fixtures in
  // ./seeds show up for anyone who clones the repo — they ride in the bundle,
  // so there is nothing to configure and no folder to point at.
  useSeeder({
    queryClient,
    // Patches `fetch`, so responses can be seeded below the cache — which also
    // exercises the app's real parsing on the way up, where a seeded cache
    // entry would bypass it.
    http: true,
    fixtures: require.context('./seeds', false, /\.json$/),
    // Written by `npx data-seed extract` from the types in ./api.ts, so the
    // panel can generate data instead of making you type it.
    schemas: require('./data-seed.schemas.json'),
  })

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, theme.root]} edges={['top', 'bottom']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, theme.title]}>Data Seed</Text>
          <Text style={[styles.subtitle, theme.subtitle]}>
            Open React Native DevTools → Data Seed, then seed any of these.
          </Text>

          <Controls theme={theme} />

          <Panel label='["todos"]' theme={theme}>
            <TodosCard theme={theme} />
          </Panel>

          <Panel label='["user", 7]' theme={theme}>
            <UserCard theme={theme} />
          </Panel>

          <Panel label='["settings"]' theme={theme}>
            <SettingsCard theme={theme} />
          </Panel>

          <Panel label='["thread", 42]' theme={theme}>
            <ThreadCard theme={theme} />
          </Panel>

          <Panel label='["notifications"]' theme={theme}>
            <NotificationsCard theme={theme} />
          </Panel>

          <Panel label="GET /v1/profile · fetch" theme={theme}>
            <ProfileCard theme={theme} />
          </Panel>

          <Panel label="GET /v1/orders · axios" theme={theme}>
            <OrdersCard theme={theme} />
          </Panel>

          <Panel label="GET /v1/invoice · expo/fetch" theme={theme}>
            <InvoiceCard theme={theme} />
          </Panel>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

function Controls({ theme }: { theme: Theme }) {
  const client = useQueryClient()
  const [failing, setFailingState] = useState(isFailing())

  return (
    <View style={styles.controls}>
      <Button
        label={failing ? 'Repair the API' : 'Break the API'}
        onPress={() => {
          const next = !failing
          setFailing(next)
          setFailingState(next)
          client.invalidateQueries()
        }}
        theme={theme}
        tone={failing ? 'danger' : 'default'}
      />
      <Button
        label="Refetch all"
        onPress={() => client.invalidateQueries()}
        theme={theme}
      />
    </View>
  )
}

function TodosCard({ theme }: { theme: Theme }) {
  const { data, status, fetchStatus, error } = useQuery({
    queryKey: ['todos'],
    queryFn: fetchTodos,
  })
  return (
    <State error={error} fetchStatus={fetchStatus} status={status} theme={theme}>
      {data?.data.map((todo) => (
        <Text key={todo.id} style={[styles.row, theme.row]}>
          {todo.done ? '✓' : '○'} {todo.title}
        </Text>
      ))}
    </State>
  )
}

function UserCard({ theme }: { theme: Theme }) {
  const { data, status, fetchStatus, error } = useQuery({
    queryKey: ['user', 7],
    queryFn: () => fetchUser(7),
  })
  return (
    <State error={error} fetchStatus={fetchStatus} status={status} theme={theme}>
      <Text style={[styles.row, theme.row]}>{data?.data.name}</Text>
      <Text style={[styles.dim, theme.dim]}>{data?.data.email}</Text>
    </State>
  )
}

function SettingsCard({ theme }: { theme: Theme }) {
  const { data, status, fetchStatus, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  return (
    <State error={error} fetchStatus={fetchStatus} status={status} theme={theme}>
      <Text style={[styles.row, theme.row]}>theme: {data?.data.theme}</Text>
      <Text style={[styles.dim, theme.dim]}>
        flags: {JSON.stringify(data?.data.flags)}
      </Text>
    </State>
  )
}

function ThreadCard({ theme }: { theme: Theme }) {
  const { data, status, fetchStatus, error } = useQuery({
    queryKey: ['thread', 42],
    queryFn: () => fetchThread(42),
  })
  return (
    <State error={error} fetchStatus={fetchStatus} status={status} theme={theme}>
      <Text style={[styles.row, theme.row]}>
        {data?.data.author}: {data?.data.body}
      </Text>
      <Text style={[styles.dim, theme.dim]}>
        {data?.data.replies.length ?? 0} replies
      </Text>
    </State>
  )
}

function NotificationsCard({ theme }: { theme: Theme }) {
  const { data, status, fetchStatus, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
  })
  return (
    <State error={error} fetchStatus={fetchStatus} status={status} theme={theme}>
      {data?.data.map((item) => (
        <Text key={item.id} style={[styles.row, theme.row]}>
          [{item.kind}]{' '}
          {item.kind === 'mention'
            ? `${item.from} mentioned you`
            : item.kind === 'system'
              ? item.message
              : `${item.count} updates`}
        </Text>
      ))}
    </State>
  )
}

/**
 * The cards with no React Query in them at all.
 *
 * Raw requests in an effect, which is the case the HTTP adapter exists for — if
 * these needed a query cache to be seedable, the adapter would be pointless.
 */
function useRemote<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const run = useCallback(() => {
    setLoading(true)
    let cancelled = false
    load()
      .then((next) => {
        if (cancelled) return
        setData(next)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setData(null)
        setError(cause instanceof Error ? cause.message : 'failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `load` is a module-level function per card, so this is stable.
  }, [load])

  useEffect(run, [run])
  return { data, error, loading, run }
}

function Remote<T>({
  theme,
  state,
  children,
}: {
  theme: Theme
  state: ReturnType<typeof useRemote<T>>
  children: (data: T) => React.ReactNode
}) {
  return (
    <>
      {state.loading ? <Text style={[styles.dim, theme.dim]}>loading…</Text> : null}
      {state.error && !state.loading ? (
        <Text style={styles.error}>{state.error}</Text>
      ) : null}
      {state.data ? children(state.data) : null}
      <View style={styles.cardControls}>
        <Button label="Request again" onPress={state.run} theme={theme} />
      </View>
    </>
  )
}

function ProfileCard({ theme }: { theme: Theme }) {
  const state = useRemote<Profile>(fetchProfile)
  return (
    <Remote state={state} theme={theme}>
      {(profile) => (
        <>
          <Text style={[styles.row, theme.row]}>{profile.name}</Text>
          <Text style={[styles.dim, theme.dim]}>
            {profile.email} · {profile.followers} followers
          </Text>
        </>
      )}
    </Remote>
  )
}

function OrdersCard({ theme }: { theme: Theme }) {
  const state = useRemote<Order[]>(fetchOrders)
  return (
    <Remote state={state} theme={theme}>
      {(orders) => (
        <>
          {orders.map((order) => (
            <Text key={order.id} style={[styles.row, theme.row]}>
              {order.status} · {order.total.toFixed(2)}
            </Text>
          ))}
        </>
      )}
    </Remote>
  )
}

function InvoiceCard({ theme }: { theme: Theme }) {
  const state = useRemote<Invoice>(fetchInvoice)
  return (
    <Remote state={state} theme={theme}>
      {(invoice) => (
        <>
          <Text style={[styles.row, theme.row]}>
            {invoice.number} · {invoice.amountDue.toFixed(2)}
          </Text>
          <Text style={[styles.dim, theme.dim]}>
            {invoice.paid ? 'paid' : 'due'} {invoice.dueAt.slice(0, 10)}
          </Text>
        </>
      )}
    </Remote>
  )
}

// ---- presentation ----

function State({
  status,
  fetchStatus,
  error,
  theme,
  children,
}: {
  status: string
  fetchStatus: string
  error: unknown
  theme: Theme
  children: React.ReactNode
}) {
  if (status === 'pending') {
    return <Text style={[styles.dim, theme.dim]}>loading…</Text>
  }
  if (status === 'error') {
    return (
      <Text style={styles.error}>
        {error instanceof Error ? error.message : 'failed'}
      </Text>
    )
  }
  return (
    <>
      {children}
      {fetchStatus === 'fetching' ? (
        <Text style={[styles.dim, theme.dim]}>refetching…</Text>
      ) : null}
    </>
  )
}

function Panel({
  label,
  theme,
  children,
}: {
  label: string
  theme: Theme
  children: React.ReactNode
}) {
  return (
    <View style={[styles.panel, theme.panel]}>
      <Text style={[styles.key, theme.key]}>{label}</Text>
      {children}
    </View>
  )
}

function Button({
  label,
  onPress,
  theme,
  tone = 'default',
}: {
  label: string
  onPress: () => void
  theme: Theme
  tone?: 'default' | 'danger'
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        theme.button,
        tone === 'danger' && styles.buttonDanger,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonLabel, theme.buttonLabel]}>{label}</Text>
    </Pressable>
  )
}

type Theme = typeof light

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, marginBottom: 4 },
  controls: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  cardControls: { flexDirection: 'row', gap: 8, marginTop: 8 },
  panel: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  key: { fontFamily: 'Menlo', fontSize: 12, marginBottom: 4 },
  row: { fontSize: 14 },
  dim: { fontSize: 12 },
  error: { fontSize: 13, color: '#c0392b' },
  button: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonDanger: { borderColor: '#c0392b' },
  buttonPressed: { opacity: 0.6 },
  buttonLabel: { fontSize: 13, fontWeight: '600' },
})

const light = StyleSheet.create({
  root: { backgroundColor: '#fbfbfd' },
  title: { color: '#111' },
  subtitle: { color: '#666' },
  panel: { backgroundColor: '#fff', borderColor: '#e4e4e7' },
  key: { color: '#7c3aed' },
  row: { color: '#111' },
  dim: { color: '#777' },
  button: { backgroundColor: '#fff', borderColor: '#d4d4d8' },
  buttonLabel: { color: '#111' },
})

const dark = StyleSheet.create({
  root: { backgroundColor: '#0b0b0d' },
  title: { color: '#f4f4f5' },
  subtitle: { color: '#a1a1aa' },
  panel: { backgroundColor: '#151517', borderColor: '#27272a' },
  key: { color: '#c4b5fd' },
  row: { color: '#f4f4f5' },
  dim: { color: '#a1a1aa' },
  button: { backgroundColor: '#1c1c1f', borderColor: '#3f3f46' },
  buttonLabel: { color: '#f4f4f5' },
})
