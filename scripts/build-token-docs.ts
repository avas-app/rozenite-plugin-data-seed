/**
 * Regenerates the token table in `README.md`, between the `tokens:start` and
 * `tokens:end` markers.
 *
 * Run with `bun run docs`.
 *
 * The examples are produced by calling the generator, not written down — a
 * hand-maintained table of what a generator emits is wrong the first time
 * someone edits the generator and forgets the docs, and the whole point of
 * documenting the vocabulary is that it is trustworthy.
 */

import fs from 'node:fs'
import path from 'node:path'

import { TOKENS, sampleToken } from '../src/shared/generate'

const README = path.resolve(import.meta.dir, '../README.md')
const START = '<!-- tokens:start -->'
const END = '<!-- tokens:end -->'

/** Keeps a long lorem paragraph from blowing the column width apart. */
function clip(text: string, max = 52): string {
  const single = text.replace(/\s+/g, ' ')
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

const rows = TOKENS.map((entry) => {
  const args = entry.args ? `\`${entry.args}\`` : ''
  return `| \`${entry.token}\` | ${cell(entry.summary)} | ${args} | \`${cell(clip(sampleToken(entry.token)))}\` |`
})

const table = [
  '| Token | Produces | Arguments | Example |',
  '| --- | --- | --- | --- |',
  ...rows,
].join('\n')

const readme = fs.readFileSync(README, 'utf8')
const from = readme.indexOf(START)
const to = readme.indexOf(END)
if (from === -1 || to === -1) {
  throw new Error(`README.md is missing the ${START} / ${END} markers`)
}

const next = `${readme.slice(0, from + START.length)}\n\n${table}\n\n${readme.slice(to)}`
fs.writeFileSync(README, next, 'utf8')

console.log(`Wrote ${TOKENS.length} tokens to README.md`)
