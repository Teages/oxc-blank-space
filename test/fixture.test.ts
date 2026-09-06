import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tsBlankSpace from 'ts-blank-space'
import { expect, it } from 'vitest'
import { transpile } from '../src/index'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixture')

for (const filename of readdirSync(fixtureDir).filter(f =>
  f.endsWith('.ts'),
)) {
  it(`fixture: ${filename}`, () => {
    // Given: a case file from the ts-blank-space fixture corpus and its
    // committed expected output
    const input = readFileSync(join(fixtureDir, filename), 'utf8')
    const expected = readFileSync(
      join(fixtureDir, filename.replace(/\.ts$/, '.js')),
      'utf8',
    )
    // When: transpiled with this library and with ts-blank-space
    const output = transpile(input)
    const reference = tsBlankSpace(input)
    // Then: all three agree byte for byte
    expect(output).toBe(reference)
    expect(output).toBe(expected)
  })
}
