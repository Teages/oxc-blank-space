import type { UnsupportedSyntax } from '../src/native'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { transpile } from '../src/index'
import {
  nativeBindingAvailable,
  transpileAsync,
  transpileSync,
} from '../src/native'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixture')

if (process.env.NATIVE_REQUIRED === '1' && !nativeBindingAvailable) {
  throw new Error(
    'NATIVE_REQUIRED=1 but the native binary is missing; run pnpm build:native',
  )
}

const asyncParityChecks: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const check of asyncParityChecks) {
    await check()
  }
})

describe.skipIf(!nativeBindingAvailable)('experimental-native', () => {
  for (const filename of readdirSync(fixtureDir).filter(f =>
    f.endsWith('.ts'),
  )) {
    it(`fixture parity: ${filename}`, async () => {
      // Given: a case file from the ts-blank-space fixture corpus whose JS
      // output already matches the reference implementation byte for byte
      const input = readFileSync(join(fixtureDir, filename), 'utf8')
      const expected = transpile(input)
      // When: transpiled with the native implementation (async and sync)
      const asyncOutput = await transpileAsync(input)
      const syncOutput = transpileSync(input)
      // Then: both agree with the JS implementation byte for byte
      expect(asyncOutput).toBe(expected)
      expect(syncOutput).toBe(expected)
    })
  }

  it('blanks type annotations like the JS implementation', async () => {
    const input = `const a: number = 1`
    expect(await transpileAsync(input)).toBe(transpile(input))
  })

  it('expands enums in place', async () => {
    const input = `enum Color { Red, Green = 5 }`
    const output = await transpileAsync(input)
    expect(output).toBe(transpile(input))
    expect(output).toContain(`Color["Red"] = 0`)
  })

  it('reports unsupported constructs through onError', async () => {
    const input = `class C { constructor(private a: string) {} }`
    const jsReports: UnsupportedSyntax[] = []
    transpile(input, { onError: node => jsReports.push(node) })
    const nativeReports: UnsupportedSyntax[] = []
    const output = await transpileAsync(input, {
      onError: node => nativeReports.push(node),
    })
    expect(output).toBe(transpile(input))
    expect(nativeReports).toEqual(jsReports)
    expect(nativeReports[0]).toMatchObject({ type: 'TSParameterProperty' })
  })

  it('reports multiple kept-verbatim constructs on the sync path', () => {
    const input = `export = foo;\nimport x = require('y');\nlet a = b!;\n`
    const nativeReports: UnsupportedSyntax[] = []
    transpileSync(input, {
      onError: node => nativeReports.push(node),
    })
    const types = nativeReports.map(node => node.type)
    expect(types).toContain('TSExportAssignment')
    expect(types).toContain('TSImportEqualsDeclaration')
  })

  it('supports the tsx language mode', async () => {
    const input = `const el = <div prop={'a' as const}>hi</div>\n`
    const output = await transpileAsync(input, { lang: 'tsx' })
    expect(output).toBe(transpile(input, { lang: 'tsx' }))
  })

  it('honors the filename option for JSX parsing', async () => {
    const input = `const el = <a href>link</a>\n`
    const output = await transpileAsync(input, { filename: 'input.tsx' })
    expect(output).toBe(transpile(input, { filename: 'input.tsx' }))
  })

  it('rejects unparseable input with a SyntaxError', async () => {
    const input = `const a: = ;`
    await expect(transpileAsync(input)).rejects.toThrow(SyntaxError)
    await expect(transpileAsync(input)).rejects.toThrow(/failed to parse input\.ts/)
    expect(() => transpileSync(input)).toThrow(SyntaxError)
  })

  it('reports onError offsets as UTF-16 character offsets for non-ASCII input', async () => {
    // `文` is 1 UTF-16 unit but 3 UTF-8 bytes, `😀` is 2 units / 4 bytes —
    // JS offsets are character-based, the native entry must match.
    const input = `const 文 = "😀"; export = foo;`
    const jsReports: UnsupportedSyntax[] = []
    transpile(input, { onError: node => jsReports.push(node) })
    const nativeReports: UnsupportedSyntax[] = []
    const output = await transpileAsync(input, {
      onError: node => nativeReports.push(node),
    })
    expect(output).toBe(transpile(input))
    expect(nativeReports).toEqual(jsReports)
    const [report] = nativeReports
    expect(input.slice(report.start, report.end)).toBe('export = foo;')
    const syncReports: UnsupportedSyntax[] = []
    transpileSync(input, { onError: node => syncReports.push(node) })
    expect(syncReports).toEqual(jsReports)
  })

  it('formats large enum constants with JS shortest round-trip digits', async () => {
    // the double nearest to 1000000000000000100 prints with JS shortest
    // round-trip digits, not its exact binary value ...128
    const input = `enum E { A = 1000000000000000100 }`
    const output = await transpileAsync(input)
    expect(output).toBe(transpile(input))
    expect(output).toContain('1000000000000000100')
    expect(output).not.toContain('1000000000000000128')
    const syncOutput = transpileSync(input)
    expect(syncOutput).toBe(transpile(input))
    expect(syncOutput).toContain('1000000000000000100')
  })

  it('propagates onError exceptions unchanged from both entries', async () => {
    const input = `class C { constructor(private a: string) {} }`
    const sentinel = new Error('sentinel from onError')
    await expect(
      transpileAsync(input, {
        onError: () => {
          throw sentinel
        },
      }),
    ).rejects.toBe(sentinel)
    expect(() =>
      transpileSync(input, {
        onError: () => {
          throw sentinel
        },
      }),
    ).toThrow(sentinel)
  })

  it('serves raw lone surrogates through the JS implementation', async () => {
    // Raw lone surrogates cannot survive the UTF-8 boundary into Rust, so
    // inputs containing one fall back to the JS implementation and keep the
    // character losslessly.
    const input = `// ${String.fromCharCode(0xD800)}\nlet a = 1;`
    const jsOutput = transpile(input)
    expect(jsOutput).toContain(String.fromCharCode(0xD800))
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('formats seeded random doubles identically to JS on both entries', () => {
    // deterministic xorshift-style PRNG over raw f64 bit patterns, plus the
    // structured edge values (known ties, extremes, subnormals)
    const mulberry32 = (seed: number): (() => number) => {
      let state = seed
      return () => {
        state |= 0
        state = (state + 0x6D2B79F5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const random = mulberry32(0xC0FFEE)
    const randomBits = (): bigint =>
      (BigInt(Math.floor(random() * 2 ** 32)) << 32n)
      | BigInt(Math.floor(random() * 2 ** 32) >>> 0)

    const values = [
      Number('1381472817847324.2'),
      0.1,
      5e-324,
      1e-323,
      1 - Number.EPSILON / 2,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      1e21,
      1e-7,
      Number('1000000000000000128'),
    ]
    const view = new DataView(new ArrayBuffer(8))
    while (values.length < 3000) {
      view.setBigUint64(0, randomBits())
      const value = view.getFloat64(0)
      if (Number.isFinite(value)) {
        values.push(value)
      }
    }

    for (const value of values) {
      const input = `enum E { A = ${String(value)} }`
      const jsOutput = transpile(input)
      const expectedFragment = `E["A"] = ${String(value)}]`
      expect(transpileSync(input)).toBe(jsOutput)
      expect(transpileSync(input)).toContain(expectedFragment)
      asyncParityChecks.push(async () => {
        expect(await transpileAsync(input)).toBe(jsOutput)
        expect(await transpileAsync(input)).toContain(expectedFragment)
      })
    }
  })

  it('rejects grouping-unsafe as-erasures with a SyntaxError', async () => {
    // `1 + 1 as T / 2` would change meaning when the assertion is erased;
    // oxc refuses to parse it, and the native binding must surface that.
    const input = `1 + 1 as T / 2;\n`
    await expect(transpileAsync(input)).rejects.toThrow(SyntaxError)
  })
})
