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
 *
 * The presets exist so the panel can be developed — and reviewed — without a
 * device attached. `rozenite dev` serves the real panel and injects these as if
 * they had arrived over the bridge.
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
        name: 'Cache with fixtures and schemas',
        type: 'seed:snapshot',
        payload: {
          "frames": [],
          "queries": [
                    {
                              "queryHash": "[\"todos\"]",
                              "queryKey": [
                                        "todos"
                              ],
                              "status": "success",
                              "fetchStatus": "idle",
                              "observerCount": 1,
                              "dataUpdatedAt": 0,
                              "seeded": false,
                              "preview": {
                                        "kind": "json",
                                        "byteLength": 241,
                                        "value": {
                                                  "data": [
                                                            {
                                                                      "id": 1,
                                                                      "title": "Wire up the bridge"
                                                            }
                                                  ],
                                                  "meta": {
                                                            "requestId": "req_1"
                                                  }
                                        }
                              }
                    },
                    {
                              "queryHash": "[\"user\",7]",
                              "queryKey": [
                                        "user",
                                        7
                              ],
                              "status": "success",
                              "fetchStatus": "idle",
                              "observerCount": 1,
                              "dataUpdatedAt": 0,
                              "seeded": true,
                              "preview": {
                                        "kind": "json",
                                        "byteLength": 196,
                                        "value": {
                                                  "data": {
                                                            "name": "Seeded User"
                                                  }
                                        }
                              }
                    },
                    {
                              "queryHash": "[\"notifications\"]",
                              "queryKey": [
                                        "notifications"
                              ],
                              "status": "error",
                              "fetchStatus": "idle",
                              "observerCount": 0,
                              "dataUpdatedAt": 0,
                              "seeded": false,
                              "error": "Request failed with status 500"
                    },
                    {
                              "queryHash": "[\"settings\"]",
                              "queryKey": [
                                        "settings"
                              ],
                              "status": "pending",
                              "fetchStatus": "fetching",
                              "observerCount": 2,
                              "dataUpdatedAt": 0,
                              "seeded": false
                    }
          ],
          "seeds": [
                    {
                              "queryHash": "[\"user\",7]",
                              "queryKey": [
                                        "user",
                                        7
                              ],
                              "appliedAt": 0,
                              "byteLength": 196
                    }
          ],
          "fixtures": [
                    {
                              "id": "./todos-empty.json",
                              "name": "todos \u2014 empty state",
                              "queryKey": [
                                        "todos"
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 74
                    },
                    {
                              "id": "./todos-long-list.json",
                              "name": "todos \u2014 200 items",
                              "queryKey": [
                                        "todos"
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 39104
                    },
                    {
                              "id": "./notifications-all-kinds.json",
                              "name": "notifications \u2014 every union variant",
                              "queryKey": [
                                        "notifications"
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 402
                    },
                    {
                              "id": "./thread-deeply-nested.json",
                              "name": "thread \u2014 15 levels deep",
                              "queryKey": [
                                        "thread",
                                        42
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 5820
                    }
          ],
          "fixtureProblems": [
                    {
                              "id": "broken-on-purpose.json",
                              "reason": "queryKey must be an array"
                    }
          ],
          "schemas": [
                    {
                              "pattern": [
                                        "todos"
                              ],
                              "type": "ApiResponse<Todo[]>"
                    },
                    {
                              "pattern": [
                                        "user",
                                        "*"
                              ],
                              "type": "ApiResponse<User>"
                    },
                    {
                              "pattern": [
                                        "notifications"
                              ],
                              "type": "ApiResponse<Notification[]>"
                    }
          ],
          "capabilities": {
                    "intercept": true,
                    "fixtures": true,
                    "schemas": true
          }
},
      },
      {
        name: 'Schema for ["todos"]',
        type: 'seed:schema',
        payload: { pattern: ['todos'], schema: {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "$ref": "#/definitions/ApiResponse%3Cdef-alias-example_api.ts-1361-1509-example_api.ts-0-4636%5B%5D%3E",
          "definitions": {
                    "ApiResponse<def-alias-example_api.ts-1361-1509-example_api.ts-0-4636[]>": {
                              "type": "object",
                              "properties": {
                                        "data": {
                                                  "type": "array",
                                                  "items": {
                                                            "$ref": "#/definitions/Todo"
                                                  }
                                        },
                                        "meta": {
                                                  "type": "object",
                                                  "properties": {
                                                            "requestId": {
                                                                      "type": "string"
                                                            },
                                                            "durationMs": {
                                                                      "type": "number"
                                                            }
                                                  },
                                                  "required": [
                                                            "requestId",
                                                            "durationMs"
                                                  ],
                                                  "additionalProperties": false
                                        }
                              },
                              "required": [
                                        "data",
                                        "meta"
                              ],
                              "additionalProperties": false,
                              "description": "Generic envelope, as most real APIs have."
                    },
                    "Todo": {
                              "type": "object",
                              "properties": {
                                        "id": {
                                                  "type": "number"
                                        },
                                        "title": {
                                                  "type": "string",
                                                  "faker": "lorem.sentence"
                                        },
                                        "done": {
                                                  "type": "boolean"
                                        },
                                        "createdAt": {
                                                  "type": "string",
                                                  "faker": "date.recent"
                                        }
                              },
                              "required": [
                                        "id",
                                        "title",
                                        "done",
                                        "createdAt"
                              ],
                              "additionalProperties": false
                    }
          }
} },
      },
      {
        name: 'Value for ["todos"]',
        type: 'seed:data',
        payload: {
          queryHash: '["todos"]',
          data: {
            kind: 'json',
            byteLength: 96,
            value: {
              data: [{ id: 1, title: 'Wire up the bridge', done: true }],
              meta: { requestId: 'req_1', durationMs: 400 },
            },
          },
        },
      },
      {
        name: 'Interception unavailable',
        type: 'seed:snapshot',
        payload: {
          "frames": [],
          "queries": [
                    {
                              "queryHash": "[\"todos\"]",
                              "queryKey": [
                                        "todos"
                              ],
                              "status": "success",
                              "fetchStatus": "idle",
                              "observerCount": 1,
                              "dataUpdatedAt": 0,
                              "seeded": false,
                              "preview": {
                                        "kind": "json",
                                        "byteLength": 241,
                                        "value": {
                                                  "data": [
                                                            {
                                                                      "id": 1,
                                                                      "title": "Wire up the bridge"
                                                            }
                                                  ],
                                                  "meta": {
                                                            "requestId": "req_1"
                                                  }
                                        }
                              }
                    },
                    {
                              "queryHash": "[\"user\",7]",
                              "queryKey": [
                                        "user",
                                        7
                              ],
                              "status": "success",
                              "fetchStatus": "idle",
                              "observerCount": 1,
                              "dataUpdatedAt": 0,
                              "seeded": true,
                              "preview": {
                                        "kind": "json",
                                        "byteLength": 196,
                                        "value": {
                                                  "data": {
                                                            "name": "Seeded User"
                                                  }
                                        }
                              }
                    },
                    {
                              "queryHash": "[\"notifications\"]",
                              "queryKey": [
                                        "notifications"
                              ],
                              "status": "error",
                              "fetchStatus": "idle",
                              "observerCount": 0,
                              "dataUpdatedAt": 0,
                              "seeded": false,
                              "error": "Request failed with status 500"
                    },
                    {
                              "queryHash": "[\"settings\"]",
                              "queryKey": [
                                        "settings"
                              ],
                              "status": "pending",
                              "fetchStatus": "fetching",
                              "observerCount": 2,
                              "dataUpdatedAt": 0,
                              "seeded": false
                    }
          ],
          "seeds": [
                    {
                              "queryHash": "[\"user\",7]",
                              "queryKey": [
                                        "user",
                                        7
                              ],
                              "appliedAt": 0,
                              "byteLength": 196
                    }
          ],
          "fixtures": [
                    {
                              "id": "./todos-empty.json",
                              "name": "todos \u2014 empty state",
                              "queryKey": [
                                        "todos"
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 74
                    },
                    {
                              "id": "./todos-long-list.json",
                              "name": "todos \u2014 200 items",
                              "queryKey": [
                                        "todos"
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 39104
                    },
                    {
                              "id": "./notifications-all-kinds.json",
                              "name": "notifications \u2014 every union variant",
                              "queryKey": [
                                        "notifications"
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 402
                    },
                    {
                              "id": "./thread-deeply-nested.json",
                              "name": "thread \u2014 15 levels deep",
                              "queryKey": [
                                        "thread",
                                        42
                              ],
                              "savedAt": "2026-08-19T10:00:00.000Z",
                              "byteLength": 5820
                    }
          ],
          "fixtureProblems": [
                    {
                              "id": "broken-on-purpose.json",
                              "reason": "queryKey must be an array"
                    }
          ],
          "schemas": [
                    {
                              "pattern": [
                                        "todos"
                              ],
                              "type": "ApiResponse<Todo[]>"
                    },
                    {
                              "pattern": [
                                        "user",
                                        "*"
                              ],
                              "type": "ApiResponse<User>"
                    },
                    {
                              "pattern": [
                                        "notifications"
                              ],
                              "type": "ApiResponse<Notification[]>"
                    }
          ],
          "capabilities": {
                    "intercept": false,
                    "fixtures": true,
                    "schemas": true
          }
},
      },
      {
        name: 'Empty cache',
        type: 'seed:snapshot',
        payload: {
          frames: [],
          queries: [],
          seeds: [],
          fixtures: [],
          fixtureProblems: [],
          schemas: [],
          capabilities: { intercept: true, fixtures: false, schemas: false },
        },
      },
    ],
  },
}
