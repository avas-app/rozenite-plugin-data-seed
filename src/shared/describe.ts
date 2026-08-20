import type { SchemaDocument, SchemaNode } from './schema'
import { readTag } from './generate'

/**
 * Renders an extracted JSON Schema back into readable TypeScript.
 *
 * The point is to answer "what shape is this query?" without leaving the panel
 * and going to find the type in the source. So the output is deliberately
 * TypeScript rather than JSON Schema — that is the form the reader already
 * knows, and it is what they would have gone looking for.
 *
 * Two things it surfaces that the source does not, at least not at a glance:
 * which fields carry a `@fake` annotation, and which are `any`. The second
 * matters because those are exactly the fields generation cannot fill.
 */

/** Depth guard. Recursion is normally handled by naming, not by cutting off. */
const MAX_DEPTH = 12

const INDENT = '  '

export function describeSchema(
  document: SchemaDocument,
  rootName: string,
): string {
  const definitions = document.definitions ?? {}
  const counts = new Map<string, number>()
  countRefs(document, definitions, counts, new Set())

  /**
   * A definition is worth naming if it is shared, self-referential, or a union.
   *
   * Inlining everything else keeps the output short and hides the synthetic
   * names the schema generator invents for anonymous types. Unions are the
   * exception because inlining one inside an array is genuinely ambiguous —
   * `A | B[]` does not mean what it looks like, and the parenthesised form is
   * harder to read than just giving the union its name back.
   */
  const named = new Set(
    Object.keys(definitions).filter(
      (name) =>
        (counts.get(name) ?? 0) > 1 ||
        isRecursive(name, definitions) ||
        isUnion(definitions[name]),
    ),
  )

  const declare = (name: string, body: string): string =>
    // A body that starts on its own line is a stacked union; `type X =` then
    // reads correctly with the first pipe below it.
    body.startsWith('\n') ? `type ${name} =${body}` : `type ${name} = ${body}`

  const blocks: string[] = [
    declare(rootName, render(document, definitions, named, 0, new Set())),
  ]

  for (const name of named) {
    const body = render(definitions[name], definitions, named, 0, new Set([name]))
    blocks.push(declare(displayName(name), body))
  }

  return blocks.join('\n\n')
}

function render(
  node: SchemaNode | undefined,
  definitions: Record<string, SchemaNode>,
  named: Set<string>,
  depth: number,
  expanding: Set<string>,
): string {
  if (!node) return 'unknown'
  if (depth > MAX_DEPTH) return '…'

  if (node.$ref) {
    const key = refName(node.$ref)
    if (!key || !definitions[key]) return 'unknown'
    // A named definition is printed as its name; expanding it here is what
    // would make a recursive type infinite.
    if (named.has(key) || expanding.has(key)) return displayName(key)
    return render(
      definitions[key],
      definitions,
      named,
      depth,
      new Set([...expanding, key]),
    )
  }

  if (node.const !== undefined) return literal(node.const)

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum.map(literal).join(' | ')
  }

  const branches = node.anyOf ?? node.oneOf
  if (branches && branches.length > 0) {
    const parts = branches.map((branch) =>
      render(branch, definitions, named, depth + 1, expanding),
    )
    if (!parts.some((part) => part.includes('\n'))) return parts.join(' | ')
    // A union of objects run together on one line is unreadable, which is what
    // a discriminated union always produces. Leading pipes, one per line, is
    // how the same thing is written in source.
    const pad = INDENT.repeat(depth + 1)
    return `\n${parts.map((part) => `${pad}| ${part}`).join('\n')}`
  }

  if (node.allOf && node.allOf.length > 0) {
    return node.allOf
      .map((part) => render(part, definitions, named, depth, expanding))
      .join(' & ')
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type

  if (type === 'array') {
    const items = Array.isArray(node.items) ? node.items[0] : node.items
    const inner = render(items, definitions, named, depth, expanding)
    // Parenthesise anything where `[]` would otherwise bind to the last member
    // rather than the whole thing.
    const ambiguous = inner.includes('|') || inner.includes('&')
    return ambiguous ? `(${inner})[]` : `${inner}[]`
  }

  if (type === 'object') return renderObject(node, definitions, named, depth, expanding)

  if (type) return type

  // No `type` at all is `any` or `unknown` in the source. Naming it is the
  // whole point: these are the fields generation has to leave null.
  return 'any'
}

function renderObject(
  node: SchemaNode,
  definitions: Record<string, SchemaNode>,
  named: Set<string>,
  depth: number,
  expanding: Set<string>,
): string {
  const properties = node.properties ?? {}
  const entries = Object.entries(properties)
  if (entries.length === 0) return '{}'

  const required = new Set(node.required ?? [])
  const pad = INDENT.repeat(depth + 1)

  const lines = entries.map(([key, child]) => {
    const optional = required.has(key) ? '' : '?'
    const rendered = render(child, definitions, named, depth + 1, expanding)
    // Echoes the spelling the source used rather than normalising to `@fake`:
    // this is a preview of the type as written, and silently rewriting it would
    // send you looking for a line that says something else.
    const tag = readTag(child)
    const annotation = tag ? `  // @${tag.tag} ${tag.value}` : ''
    return `${pad}${key}${optional}: ${rendered}${annotation}`
  })

  return `{\n${lines.join('\n')}\n${INDENT.repeat(depth)}}`
}

function literal(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value)
}

function refName(ref: string): string | null {
  const match = /^#\/definitions\/(.+)$/.exec(ref)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Cleans up the synthetic names the schema generator invents.
 *
 * Anonymous and aliased types come out as
 * `ApiResponse<def-alias-src_api.ts-1361-1509-…[]>`, which is noise in a shape
 * preview. Most of those get inlined and never printed, but a shared one can
 * still reach here.
 */
export function displayName(name: string): string {
  const cleaned = name.replace(/def-alias-[^,<>[\]]+/g, '…')
  return cleaned === '…' ? 'Anonymous' : cleaned
}

/**
 * How many nodes one count pass may visit.
 *
 * `visiting` stops cycles but not re-walking: a definition referenced from two
 * places has its whole subtree counted twice, so a diamond-shaped graph costs
 * exponential time in its depth. That is a hang in the panel's render, with no
 * error to explain it. Past this many nodes the remaining counts are simply
 * less accurate, which at worst names a type that could have been inlined.
 */
const COUNT_BUDGET = 50_000

function countRefs(
  node: SchemaNode | undefined,
  definitions: Record<string, SchemaNode>,
  counts: Map<string, number>,
  visiting: Set<string>,
  budget: { left: number } = { left: COUNT_BUDGET },
): void {
  if (!node || typeof node !== 'object') return
  if (budget.left-- <= 0) return

  if (node.$ref) {
    const key = refName(node.$ref)
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!visiting.has(key) && definitions[key]) {
        countRefs(
          definitions[key],
          definitions,
          counts,
          new Set([...visiting, key]),
          budget,
        )
      }
    }
    return
  }

  for (const child of children(node)) {
    countRefs(child, definitions, counts, visiting, budget)
  }
}

function isUnion(node: SchemaNode | undefined): boolean {
  if (!node) return false
  return (node.anyOf?.length ?? 0) > 1 || (node.oneOf?.length ?? 0) > 1
}

function isRecursive(name: string, definitions: Record<string, SchemaNode>): boolean {
  const seen = new Set<string>()
  const walk = (node: SchemaNode | undefined): boolean => {
    if (!node) return false
    if (node.$ref) {
      const key = refName(node.$ref)
      if (!key) return false
      if (key === name) return true
      if (seen.has(key)) return false
      seen.add(key)
      return walk(definitions[key])
    }
    return children(node).some(walk)
  }
  return children(definitions[name] ?? {}).some(walk)
}

/** Every child schema node, regardless of which keyword holds it. */
function children(node: SchemaNode): SchemaNode[] {
  const out: SchemaNode[] = []
  if (node.properties) out.push(...Object.values(node.properties))
  if (node.items) out.push(...(Array.isArray(node.items) ? node.items : [node.items]))
  if (node.anyOf) out.push(...node.anyOf)
  if (node.oneOf) out.push(...node.oneOf)
  if (node.allOf) out.push(...node.allOf)
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    out.push(node.additionalProperties)
  }
  return out
}
