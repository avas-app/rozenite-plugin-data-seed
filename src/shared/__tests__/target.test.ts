import { describe, expect, test } from 'bun:test'

import {
  findByTarget,
  formatRef,
  keyTarget,
  matchesKey,
  matchesRoute,
  matchesTarget,
  parseRoutePattern,
  parseTargetPattern,
  parseTargetRef,
  refCovers,
  routeTarget,
  urlPath,
} from '../target'

describe('matchesKey', () => {
  test('matches exactly', () => {
    expect(matchesKey(['todos'], ['todos'])).toBe(true)
    expect(matchesKey(['todos'], ['users'])).toBe(false)
  })

  test('* covers a single element', () => {
    expect(matchesKey(['user', '*'], ['user', 7])).toBe(true)
    expect(matchesKey(['user', '*'], ['user', 'me'])).toBe(true)
  })

  test('length must match, so a list pattern cannot swallow a detail route', () => {
    expect(matchesKey(['todos'], ['todos', 'detail', 1])).toBe(false)
    expect(matchesKey(['user', '*'], ['user'])).toBe(false)
  })

  test('object elements compare structurally', () => {
    expect(matchesKey([{ a: 1 }], [{ a: 1 }])).toBe(true)
    expect(matchesKey([{ a: 1 }], [{ a: 2 }])).toBe(false)
  })
})

describe('parseRoutePattern', () => {
  test('splits a method off the front', () => {
    expect(parseRoutePattern('GET /api/todos')).toEqual({
      method: 'GET',
      glob: '/api/todos',
    })
  })

  test('normalises the method', () => {
    expect(parseRoutePattern('post /api/todos').method).toBe('POST')
  })

  test('a bare path means any method', () => {
    expect(parseRoutePattern('/api/todos')).toEqual({
      method: '*',
      glob: '/api/todos',
    })
  })

  test('a URL with a scheme is not mistaken for a method', () => {
    expect(parseRoutePattern('https://api.example.com/todos').glob).toBe(
      'https://api.example.com/todos',
    )
  })
})

describe('matchesRoute', () => {
  const pattern = parseRoutePattern('GET /api/todos')

  test('matches the path regardless of origin', () => {
    expect(matchesRoute(pattern, 'GET', 'https://api.example.com/api/todos')).toBe(
      true,
    )
    expect(matchesRoute(pattern, 'GET', '/api/todos')).toBe(true)
  })

  test('ignores the query string unless the pattern asks for it', () => {
    expect(
      matchesRoute(pattern, 'GET', 'https://api.example.com/api/todos?page=2'),
    ).toBe(true)
    const paged = parseRoutePattern('GET /api/todos?page=2')
    expect(matchesRoute(paged, 'GET', 'https://x.com/api/todos?page=2')).toBe(true)
    expect(matchesRoute(paged, 'GET', 'https://x.com/api/todos?page=3')).toBe(false)
  })

  test('the method has to agree', () => {
    expect(matchesRoute(pattern, 'POST', '/api/todos')).toBe(false)
    expect(matchesRoute(parseRoutePattern('/api/todos'), 'POST', '/api/todos')).toBe(
      true,
    )
  })

  test('* stays inside one segment', () => {
    const users = parseRoutePattern('GET /api/users/*')
    expect(matchesRoute(users, 'GET', '/api/users/7')).toBe(true)
    // The distinction that stops a list schema generating for a detail route.
    expect(matchesRoute(users, 'GET', '/api/users/7/posts')).toBe(false)
  })

  test('** crosses segments', () => {
    const deep = parseRoutePattern('GET /api/**')
    expect(deep.glob).toBe('/api/**')
    expect(matchesRoute(deep, 'GET', '/api/users/7/posts')).toBe(true)
  })

  test('a host pattern pins one origin', () => {
    const pinned = parseRoutePattern('GET https://api.example.com/**')
    expect(matchesRoute(pinned, 'GET', 'https://api.example.com/todos')).toBe(true)
    expect(matchesRoute(pinned, 'GET', 'https://other.example.com/todos')).toBe(false)
  })

  test('regex metacharacters in a path are literal', () => {
    const dotted = parseRoutePattern('GET /api/v1.0/todos')
    expect(matchesRoute(dotted, 'GET', '/api/v1.0/todos')).toBe(true)
    expect(matchesRoute(dotted, 'GET', '/api/v1X0/todos')).toBe(false)
  })
})

describe('urlPath', () => {
  test('strips origin and query', () => {
    expect(urlPath('https://x.com/a/b?c=1#d')).toBe('/a/b')
  })

  test('tolerates something that is not a URL', () => {
    expect(urlPath('/a/b?c=1')).toBe('/a/b')
    expect(urlPath('nonsense')).toBe('nonsense')
  })
})

describe('findByTarget', () => {
  const entries = [
    { pattern: parseTargetPattern(['user', '*']), type: 'User' },
    { pattern: parseTargetPattern(['user', 7]), type: 'AdminUser' },
    { pattern: parseTargetPattern('GET /api/users/**'), type: 'AnyUser' },
    { pattern: parseTargetPattern('GET /api/users/7'), type: 'ExactUser' },
  ]

  test('an exact pattern beats a wildcard regardless of order', () => {
    const ref = keyTarget(['user', 7]).ref
    expect(findByTarget(entries, ref)?.type).toBe('AdminUser')
    expect(findByTarget([...entries].reverse(), ref)?.type).toBe('AdminUser')
  })

  test('falls back to the wildcard for other keys', () => {
    expect(findByTarget(entries, keyTarget(['user', 9]).ref)?.type).toBe('User')
  })

  test('the same precedence applies to routes', () => {
    expect(findByTarget(entries, routeTarget('GET', '/api/users/7').ref)?.type).toBe(
      'ExactUser',
    )
    expect(findByTarget(entries, routeTarget('GET', '/api/users/9').ref)?.type).toBe(
      'AnyUser',
    )
  })

  test('a key never matches a route pattern, or the reverse', () => {
    expect(findByTarget(entries, keyTarget(['/api/users/7']).ref)).toBeNull()
    expect(findByTarget(entries, routeTarget('GET', '/nope').ref)).toBeNull()
  })
})

describe('matchesTarget', () => {
  test('kinds do not cross', () => {
    const routePattern = parseTargetPattern('GET /a')
    expect(matchesTarget(routePattern, routeTarget('GET', '/a').ref)).toBe(true)
    expect(matchesTarget(routePattern, keyTarget(['/a']).ref)).toBe(false)
  })
})

describe('parseTargetRef', () => {
  test('a bare array is a key target', () => {
    expect(parseTargetRef(['a', 1])).toEqual({ kind: 'key', key: ['a', 1] })
  })

  test('uppercases a route method', () => {
    expect(parseTargetRef({ kind: 'route', method: 'post', url: '/a' })).toEqual({
      kind: 'route',
      method: 'POST',
      url: '/a',
    })
  })

  test('defaults a missing method to GET', () => {
    expect(parseTargetRef({ kind: 'route', url: '/a' })).toEqual({
      kind: 'route',
      method: 'GET',
      url: '/a',
    })
  })

  test('rejects what it cannot understand', () => {
    expect(() => parseTargetRef({ kind: 'route' })).toThrow(/needs a url/)
    expect(() => parseTargetRef({ kind: 'key' })).toThrow(/needs a key array/)
    expect(() => parseTargetRef('nope')).toThrow(/must be an object/)
  })
})

describe('formatRef', () => {
  test('renders each kind the way it is written in source', () => {
    expect(formatRef(keyTarget(['user', 7]).ref)).toBe('["user",7]')
    expect(formatRef(routeTarget('get', '/api/a').ref)).toBe('GET /api/a')
  })
})

describe('refCovers', () => {
  test('a route seed is a pattern, so it covers the URLs it matches', () => {
    const seed = routeTarget('GET', '/v1/profile').ref
    expect(
      refCovers(seed, routeTarget('GET', 'https://api.example.invalid/v1/profile').ref),
    ).toBe(true)
    expect(refCovers(seed, routeTarget('GET', '/v1/other').ref)).toBe(false)
  })

  test('a glob seed covers every URL under it', () => {
    const seed = routeTarget('GET', '/api/users/*').ref
    expect(refCovers(seed, routeTarget('GET', 'https://x.com/api/users/7').ref)).toBe(
      true,
    )
  })

  test('key seeds still need exact equality', () => {
    const seed = keyTarget(['user', 7]).ref
    expect(refCovers(seed, keyTarget(['user', 7]).ref)).toBe(true)
    expect(refCovers(seed, keyTarget(['user', 8]).ref)).toBe(false)
  })

  test('kinds never cover each other', () => {
    expect(
      refCovers(keyTarget(['/v1/profile']).ref, routeTarget('GET', '/v1/profile').ref),
    ).toBe(false)
    expect(
      refCovers(routeTarget('GET', '/v1/profile').ref, keyTarget(['/v1/profile']).ref),
    ).toBe(false)
  })
})
