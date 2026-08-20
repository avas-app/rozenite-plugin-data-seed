/**
 * Makes `expo/fetch` seedable. Imported first, though order does not actually
 * matter — the patch is read per call, not captured at import time.
 *
 * Only Expo apps need this line; `fetch` and axios are covered by
 * `useSeeder({ http: true })` alone.
 */
import '@avasapp/rozenite-plugin-data-seed/expo'

import { registerRootComponent } from 'expo'

import App from './App'

registerRootComponent(App)
