import type { TranspileOptions } from '../src/types'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bench, describe } from 'vitest'
import { transpile } from '../src/index'
import {
  nativeBindingAvailable,
  transpileAsync,
  transpileSync,
} from '../src/native'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../test/fixture')

function fixtureInput(): string {
  return readdirSync(fixtureDir)
    .filter(file => file.endsWith('.ts'))
    .map(file => readFileSync(join(fixtureDir, file), 'utf8'))
    .join('\n')
}

/** Repeat until the input reaches roughly `target` characters. */
function enlarged(input: string, target: number): string {
  let out = input
  while (out.length < target) {
    out += input
  }
  return out
}

const enumHeavy = `enum Color { Red, Green = 5, Blue = Green + 2, Named = 'named' }
enum Flags { A = 1 << 0, B = 1 << 1, C = A | B, D = C + 1 }
const enum Private { X, Y = X * 2 }
`.repeat(25)

const samples: Array<{ name: string, input: string, options?: TranspileOptions }> = [
  {
    name: 'inline',
    input: `const a: number = 1;\nfunction greet(name: string): string { return \`hi \${name}\`; }\ninterface Shape { area(): number }\n`,
  },
  {
    name: 'fixture corpus (~15KB)',
    input: fixtureInput(),
  },
  {
    name: 'large (~100KB)',
    input: enlarged(fixtureInput(), 100_000),
  },
  {
    name: 'enum heavy',
    input: enumHeavy,
  },
]

describe.runIf(nativeBindingAvailable)('transpile: js vs native', () => {
  for (const { name, input, options } of samples) {
    // Sanity: the three implementations must agree before timing anything.
    const expected = transpile(input, options)
    if (transpileSync(input, options) !== expected) {
      throw new Error(`native sync output mismatch for ${name}`)
    }

    describe(name, () => {
      bench('js (oxc-parser + visitor)', () => {
        transpile(input, options)
      })

      bench('native transpileSync', () => {
        transpileSync(input, options)
      })

      bench('native transpileAsync', async () => {
        await transpileAsync(input, options)
      })
    })
  }
})
