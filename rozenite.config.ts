/**
 * IMPORTANT: this file must be entirely self-contained.
 *
 * Rozenite loads it by transpiling the single file to CJS and evaluating it via
 * `new Function('module', 'exports', code)` — with no `require` in scope (see
 * `@rozenite/vite-plugin/src/load-config.ts`). Any `import` here becomes a
 * `require(...)` call at runtime and fails with "require is not defined".
 *
 * That is why the presets below are literal payloads rather than being derived
 * from the shared types, and why a realistic cache lives in `example/` instead
 * of in a dev flow.
 */
export default {
  panels: [
    {
      name: 'Query Seed',
      source: './src/panel/index.tsx',
    },
  ],

  dev: {
    presets: [
      {
        name: 'Empty cache',
        type: 'seed:snapshot',
        payload: {
          queries: [],
          seeds: [],
          capabilities: { intercept: true },
        },
      },
      {
        name: 'Mixed cache (one seeded, one errored)',
        type: 'seed:snapshot',
        payload: {
          queries: [
            {
              queryHash: '["todos"]',
              queryKey: ['todos'],
              status: 'success',
              fetchStatus: 'idle',
              observerCount: 1,
              dataUpdatedAt: 0,
              seeded: true,
              preview: { kind: 'json', value: [{ id: 1 }], byteLength: 12 },
            },
            {
              queryHash: '["user",7]',
              queryKey: ['user', 7],
              status: 'error',
              fetchStatus: 'idle',
              observerCount: 0,
              dataUpdatedAt: 0,
              seeded: false,
              error: 'Request failed with status 500',
            },
          ],
          seeds: [
            {
              queryHash: '["todos"]',
              queryKey: ['todos'],
              appliedAt: 0,
              byteLength: 12,
            },
          ],
          capabilities: { intercept: true },
        },
      },
      {
        name: 'Interception unavailable',
        type: 'seed:snapshot',
        payload: {
          queries: [],
          seeds: [],
          capabilities: { intercept: false },
        },
      },
    ],
  },
}
