// Prints the release notes of the version in package.json, from src/shared/changelog.ts (English lines).
// Used by .github/workflows/release.yml.
import { readFileSync } from 'node:fs'

const v = JSON.parse(readFileSync('package.json', 'utf8')).version
const src = readFileSync('src/shared/changelog.ts', 'utf8')
const start = src.indexOf(`version: '${v}'`)
if (start < 0) {
  console.log(`Frag ${v}`)
  process.exit(0)
}
const end = src.indexOf('\n  },', start)
const block = src.slice(start, end < 0 ? undefined : end)
const unq = (s) => s.replace(/\\'/g, "'")
const title = /title: \['((?:[^'\\]|\\.)*)'/.exec(block)
const items = [...block.slice(Math.max(0, block.indexOf('items:'))).matchAll(/\[\s*'((?:[^'\\]|\\.)*)',\s*'(?:[^'\\]|\\.)*'\s*\]/g)].map((m) => `- ${unq(m[1])}`)
console.log(`${title ? `## ${unq(title[1])}\n\n` : ''}${items.join('\n')}`)
