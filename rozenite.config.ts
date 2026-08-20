/**
 * IMPORTANT: this file must be entirely self-contained.
 *
 * Rozenite loads it by transpiling the single file to CJS and evaluating it via
 * `new Function('module', 'exports', code)` — with no `require` in scope (see
 * `@rozenite/vite-plugin/src/load-config.ts`). Any `import` here becomes a
 * `require(...)` call at runtime and fails with "require is not defined".
 *
 * That is why the presets below are literal payloads. They are GENERATED — run
 * `bun run presets` to rebuild them from the real adapters (see
 * `scripts/build-dev-presets.ts`). Editing them by hand is how they drifted
 * from the wire types last time.
 *
 * The presets exist so the panel can be developed — and reviewed — without a
 * device attached. `rozenite dev` serves the real panel and injects these as if
 * they had arrived over the bridge.
 */
export default {
  panels: [
    {
      name: 'Data Seed',
      source: './src/panel/index.tsx',
    },
  ],

  dev: {
    presets: [
          {
                "name": "Everything: queries, routes, fixtures, schemas",
                "type": "seed:snapshot",
                "payload": {
                      "frames": [],
                      "targets": [
                            {
                                  "id": "react-query:[\"todos\"]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "label": "[\"todos\"]",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "data": [
                                                    {
                                                          "id": 1,
                                                          "title": "Wire up the bridge",
                                                          "done": true
                                                    }
                                              ],
                                              "meta": {
                                                    "requestId": "req_1",
                                                    "durationMs": 400
                                              }
                                        },
                                        "byteLength": 106
                                  }
                            },
                            {
                                  "id": "react-query:[\"notifications\"]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "notifications"
                                        ]
                                  },
                                  "label": "[\"notifications\"]",
                                  "status": "error",
                                  "fetchStatus": "idle",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "undefined"
                                  },
                                  "error": "Request failed with status 500"
                            },
                            {
                                  "id": "react-query:[\"settings\"]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "settings"
                                        ]
                                  },
                                  "label": "[\"settings\"]",
                                  "status": "pending",
                                  "fetchStatus": "fetching",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "undefined"
                                  }
                            },
                            {
                                  "id": "react-query:[\"user\",7]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "user",
                                              7
                                        ]
                                  },
                                  "label": "[\"user\",7]",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": true,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "data": {
                                                    "id": 7,
                                                    "name": "Seeded User",
                                                    "email": "seeded@example.com"
                                              },
                                              "meta": {
                                                    "requestId": "req_seed",
                                                    "durationMs": 0
                                              }
                                        },
                                        "byteLength": 114
                                  }
                            },
                            {
                                  "id": "http:GET https://api.example.invalid/v1/profile",
                                  "adapter": "http",
                                  "ref": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "https://api.example.invalid/v1/profile"
                                  },
                                  "label": "GET https://api.example.invalid/v1/profile",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "updatedAt": 0,
                                  "seeded": true,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "error": "upstream unavailable"
                                        },
                                        "byteLength": 32
                                  },
                                  "error": "HTTP 503",
                                  "hits": 1
                            },
                            {
                                  "id": "http:GET https://api.example.invalid/v1/feed?page=1",
                                  "adapter": "http",
                                  "ref": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "https://api.example.invalid/v1/feed?page=1"
                                  },
                                  "label": "GET https://api.example.invalid/v1/feed?page=1",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "items": [
                                                    {
                                                          "id": 1,
                                                          "headline": "Ship the adapter split"
                                                    }
                                              ],
                                              "cursor": null
                                        },
                                        "byteLength": 70
                                  },
                                  "hits": 1
                            }
                      ],
                      "seeds": [
                            {
                                  "id": "react-query:[\"user\",7]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "user",
                                              7
                                        ]
                                  },
                                  "label": "[\"user\",7]",
                                  "appliedAt": 0,
                                  "byteLength": 114
                            },
                            {
                                  "id": "http:GET /v1/profile",
                                  "adapter": "http",
                                  "ref": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "/v1/profile"
                                  },
                                  "label": "GET /v1/profile",
                                  "appliedAt": 0,
                                  "byteLength": 32,
                                  "meta": {
                                        "status": 503
                                  }
                            }
                      ],
                      "fixtures": [
                            {
                                  "id": "./notifications-all-kinds.json",
                                  "name": "notifications — every union variant",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "notifications"
                                        ]
                                  },
                                  "label": "[\"notifications\"]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 245
                            },
                            {
                                  "id": "./profile-503-outage.json",
                                  "name": "profile — 503 outage",
                                  "target": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "/v1/profile"
                                  },
                                  "label": "GET /v1/profile",
                                  "savedAt": "2026-08-20T10:00:00.000Z",
                                  "byteLength": 32
                            },
                            {
                                  "id": "./profile-power-user.json",
                                  "name": "profile — power user",
                                  "target": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "/v1/profile"
                                  },
                                  "label": "GET /v1/profile",
                                  "savedAt": "2026-08-20T10:00:00.000Z",
                                  "byteLength": 105
                            },
                            {
                                  "id": "./thread-deeply-nested.json",
                                  "name": "thread — 15 levels deep",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "thread",
                                              42
                                        ]
                                  },
                                  "label": "[\"thread\",42]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 1622
                            },
                            {
                                  "id": "./todos-long-list.json",
                                  "name": "todos — 200 items",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "label": "[\"todos\"]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 28778
                            },
                            {
                                  "id": "./todos-empty.json",
                                  "name": "todos — empty state",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "label": "[\"todos\"]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 61
                            }
                      ],
                      "fixtureProblems": [
                            {
                                  "id": "./broken-on-purpose.json",
                                  "reason": "broken-on-purpose.json: missing target"
                            }
                      ],
                      "schemas": [
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "type": "ApiResponse<Todo[]>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "user",
                                              "*"
                                        ]
                                  },
                                  "type": "ApiResponse<User>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "settings"
                                        ]
                                  },
                                  "type": "ApiResponse<Settings>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "thread",
                                              "*"
                                        ]
                                  },
                                  "type": "ApiResponse<Comment>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "notifications"
                                        ]
                                  },
                                  "type": "ApiResponse<Notification[]>"
                            },
                            {
                                  "pattern": {
                                        "kind": "route",
                                        "method": "GET",
                                        "glob": "/v1/profile"
                                  },
                                  "type": "Profile"
                            }
                      ],
                      "capabilities": {
                            "adapters": [
                                  {
                                        "id": "react-query",
                                        "label": "React Query",
                                        "intercept": true,
                                        "enumerable": true
                                  },
                                  {
                                        "id": "http",
                                        "label": "HTTP",
                                        "intercept": true,
                                        "enumerable": false
                                  }
                            ],
                            "fixtures": true,
                            "schemas": true
                      }
                }
          },
          {
                "name": "Schema for [\"todos\"]",
                "type": "seed:schema",
                "payload": {
                      "ref": {
                            "kind": "key",
                            "key": [
                                  "todos"
                            ]
                      },
                      "schema": {
                            "$schema": "http://json-schema.org/draft-07/schema#",
                            "$ref": "#/definitions/ApiResponse%3Cdef-alias-api.ts-1361-1509-api.ts-0-5801%5B%5D%3E",
                            "definitions": {
                                  "ApiResponse<def-alias-api.ts-1361-1509-api.ts-0-5801[]>": {
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
                      }
                }
          },
          {
                "name": "Schema for GET /v1/profile",
                "type": "seed:schema",
                "payload": {
                      "ref": {
                            "kind": "route",
                            "method": "GET",
                            "url": "/v1/profile"
                      },
                      "schema": {
                            "$schema": "http://json-schema.org/draft-07/schema#",
                            "$ref": "#/definitions/Profile",
                            "definitions": {
                                  "Profile": {
                                        "type": "object",
                                        "properties": {
                                              "name": {
                                                    "type": "string",
                                                    "faker": "person.fullName"
                                              },
                                              "email": {
                                                    "type": "string",
                                                    "faker": "internet.email"
                                              },
                                              "followers": {
                                                    "type": "number",
                                                    "faker": "number.int({min: 0, max: 50000})"
                                              },
                                              "joinedAt": {
                                                    "type": "string",
                                                    "faker": "date.past"
                                              }
                                        },
                                        "required": [
                                              "name",
                                              "email",
                                              "followers",
                                              "joinedAt"
                                        ],
                                        "additionalProperties": false,
                                        "description": "The one shape that arrives over a real `fetch`, for the HTTP adapter.\n\nEverything else here is a fake resolved in-process; this deliberately is not, because an adapter that patches `fetch` has nothing to intercept unless something actually calls it."
                                  }
                            }
                      }
                }
          },
          {
                "name": "Value for [\"todos\"]",
                "type": "seed:data",
                "payload": {
                      "id": "react-query:[\"todos\"]",
                      "data": {
                            "kind": "json",
                            "byteLength": 96,
                            "value": {
                                  "data": [
                                        {
                                              "id": 1,
                                              "title": "Wire up the bridge",
                                              "done": true
                                        }
                                  ],
                                  "meta": {
                                        "requestId": "req_1",
                                        "durationMs": 400
                                  }
                            }
                      }
                }
          },
          {
                "name": "Interception unavailable",
                "type": "seed:snapshot",
                "payload": {
                      "frames": [],
                      "targets": [
                            {
                                  "id": "react-query:[\"todos\"]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "label": "[\"todos\"]",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "data": [
                                                    {
                                                          "id": 1,
                                                          "title": "Wire up the bridge",
                                                          "done": true
                                                    }
                                              ],
                                              "meta": {
                                                    "requestId": "req_1",
                                                    "durationMs": 400
                                              }
                                        },
                                        "byteLength": 106
                                  }
                            },
                            {
                                  "id": "react-query:[\"notifications\"]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "notifications"
                                        ]
                                  },
                                  "label": "[\"notifications\"]",
                                  "status": "error",
                                  "fetchStatus": "idle",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "undefined"
                                  },
                                  "error": "Request failed with status 500"
                            },
                            {
                                  "id": "react-query:[\"settings\"]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "settings"
                                        ]
                                  },
                                  "label": "[\"settings\"]",
                                  "status": "pending",
                                  "fetchStatus": "fetching",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "undefined"
                                  }
                            },
                            {
                                  "id": "react-query:[\"user\",7]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "user",
                                              7
                                        ]
                                  },
                                  "label": "[\"user\",7]",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "observerCount": 0,
                                  "updatedAt": 0,
                                  "seeded": true,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "data": {
                                                    "id": 7,
                                                    "name": "Seeded User",
                                                    "email": "seeded@example.com"
                                              },
                                              "meta": {
                                                    "requestId": "req_seed",
                                                    "durationMs": 0
                                              }
                                        },
                                        "byteLength": 114
                                  }
                            },
                            {
                                  "id": "http:GET https://api.example.invalid/v1/profile",
                                  "adapter": "http",
                                  "ref": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "https://api.example.invalid/v1/profile"
                                  },
                                  "label": "GET https://api.example.invalid/v1/profile",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "updatedAt": 0,
                                  "seeded": true,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "error": "upstream unavailable"
                                        },
                                        "byteLength": 32
                                  },
                                  "error": "HTTP 503",
                                  "hits": 1
                            },
                            {
                                  "id": "http:GET https://api.example.invalid/v1/feed?page=1",
                                  "adapter": "http",
                                  "ref": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "https://api.example.invalid/v1/feed?page=1"
                                  },
                                  "label": "GET https://api.example.invalid/v1/feed?page=1",
                                  "status": "success",
                                  "fetchStatus": "idle",
                                  "updatedAt": 0,
                                  "seeded": false,
                                  "preview": {
                                        "kind": "json",
                                        "value": {
                                              "items": [
                                                    {
                                                          "id": 1,
                                                          "headline": "Ship the adapter split"
                                                    }
                                              ],
                                              "cursor": null
                                        },
                                        "byteLength": 70
                                  },
                                  "hits": 1
                            }
                      ],
                      "seeds": [
                            {
                                  "id": "react-query:[\"user\",7]",
                                  "adapter": "react-query",
                                  "ref": {
                                        "kind": "key",
                                        "key": [
                                              "user",
                                              7
                                        ]
                                  },
                                  "label": "[\"user\",7]",
                                  "appliedAt": 0,
                                  "byteLength": 114
                            },
                            {
                                  "id": "http:GET /v1/profile",
                                  "adapter": "http",
                                  "ref": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "/v1/profile"
                                  },
                                  "label": "GET /v1/profile",
                                  "appliedAt": 0,
                                  "byteLength": 32,
                                  "meta": {
                                        "status": 503
                                  }
                            }
                      ],
                      "fixtures": [
                            {
                                  "id": "./notifications-all-kinds.json",
                                  "name": "notifications — every union variant",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "notifications"
                                        ]
                                  },
                                  "label": "[\"notifications\"]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 245
                            },
                            {
                                  "id": "./profile-503-outage.json",
                                  "name": "profile — 503 outage",
                                  "target": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "/v1/profile"
                                  },
                                  "label": "GET /v1/profile",
                                  "savedAt": "2026-08-20T10:00:00.000Z",
                                  "byteLength": 32
                            },
                            {
                                  "id": "./profile-power-user.json",
                                  "name": "profile — power user",
                                  "target": {
                                        "kind": "route",
                                        "method": "GET",
                                        "url": "/v1/profile"
                                  },
                                  "label": "GET /v1/profile",
                                  "savedAt": "2026-08-20T10:00:00.000Z",
                                  "byteLength": 105
                            },
                            {
                                  "id": "./thread-deeply-nested.json",
                                  "name": "thread — 15 levels deep",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "thread",
                                              42
                                        ]
                                  },
                                  "label": "[\"thread\",42]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 1622
                            },
                            {
                                  "id": "./todos-long-list.json",
                                  "name": "todos — 200 items",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "label": "[\"todos\"]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 28778
                            },
                            {
                                  "id": "./todos-empty.json",
                                  "name": "todos — empty state",
                                  "target": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "label": "[\"todos\"]",
                                  "savedAt": "2026-08-19T10:00:00.000Z",
                                  "byteLength": 61
                            }
                      ],
                      "fixtureProblems": [
                            {
                                  "id": "./broken-on-purpose.json",
                                  "reason": "broken-on-purpose.json: missing target"
                            }
                      ],
                      "schemas": [
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "todos"
                                        ]
                                  },
                                  "type": "ApiResponse<Todo[]>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "user",
                                              "*"
                                        ]
                                  },
                                  "type": "ApiResponse<User>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "settings"
                                        ]
                                  },
                                  "type": "ApiResponse<Settings>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "thread",
                                              "*"
                                        ]
                                  },
                                  "type": "ApiResponse<Comment>"
                            },
                            {
                                  "pattern": {
                                        "kind": "key",
                                        "key": [
                                              "notifications"
                                        ]
                                  },
                                  "type": "ApiResponse<Notification[]>"
                            },
                            {
                                  "pattern": {
                                        "kind": "route",
                                        "method": "GET",
                                        "glob": "/v1/profile"
                                  },
                                  "type": "Profile"
                            }
                      ],
                      "capabilities": {
                            "adapters": [
                                  {
                                        "id": "react-query",
                                        "label": "React Query",
                                        "intercept": false,
                                        "enumerable": true
                                  },
                                  {
                                        "id": "http",
                                        "label": "HTTP",
                                        "intercept": false,
                                        "enumerable": false
                                  }
                            ],
                            "fixtures": true,
                            "schemas": true
                      }
                }
          },
          {
                "name": "Nothing seeded yet",
                "type": "seed:snapshot",
                "payload": {
                      "frames": [],
                      "targets": [],
                      "seeds": [],
                      "fixtures": [],
                      "fixtureProblems": [],
                      "schemas": [],
                      "capabilities": {
                            "adapters": [
                                  {
                                        "id": "react-query",
                                        "label": "React Query",
                                        "intercept": true,
                                        "enumerable": true
                                  },
                                  {
                                        "id": "http",
                                        "label": "HTTP",
                                        "intercept": true,
                                        "enumerable": false
                                  }
                            ],
                            "fixtures": false,
                            "schemas": false
                      }
                }
          }
    ],
  },
}
