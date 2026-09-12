import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tsBlankSpace from 'ts-blank-space'
import { expect, it } from 'vitest'
import { transpile } from './parity'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixture')

for (const filename of readdirSync(fixtureDir).filter(f =>
  f.endsWith('.ts'),
)) {
  it(`fixture: ${filename}`, () => {
    const input = readFileSync(join(fixtureDir, filename), 'utf8')
    const expected = readFileSync(
      join(fixtureDir, filename.replace(/\.ts$/, '.js')),
      'utf8',
    )
    const output = transpile(input)
    const reference = tsBlankSpace(input)
    expect(output).toBe(reference)
    expect(output).toBe(expected)
  })
}
