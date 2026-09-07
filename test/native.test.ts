import type { UnsupportedSyntax } from '../src/native'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { transpile } from '../src/index'
import {
  fromUtf16Units,
  nativeBindingAvailable,
  nativeRequire,
  toUtf16Units,
  transpileAsync,
  transpileSync,
  transpileUtf16Direct,
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

  it('serves raw lone surrogates through the UTF-16 native path', async () => {
    // Raw lone surrogates cannot survive the UTF-8 boundary into Rust, so
    // inputs containing one are routed to the UTF-16 entry points, which
    // round-trip the original code units losslessly.
    const input = `// ${String.fromCharCode(0xD800)}\nlet a = 1;`
    const jsOutput = transpile(input)
    expect(jsOutput).toContain(String.fromCharCode(0xD800))
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('matches JS for escaped lone-surrogate enum member keys', async () => {
    // pure-ASCII source whose decoded member name contains lone surrogates;
    // JSON.stringify re-escapes them exactly like the JS implementation
    const input = String.raw`enum E { "\uD800" = 1, "\uDC00" = 2 }`
    const jsOutput = transpile(input)
    expect(jsOutput).toContain('\\ud800')
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('preserves raw lone surrogates in strings and comments losslessly', async () => {
    const cases = [
      `let s = "${String.fromCharCode(0xD800)}"`,
      `let s = "${String.fromCharCode(0xD800)}"\n// ${String.fromCharCode(0xDC00)}`,
      `enum E { A = 1 } // ${String.fromCharCode(0xD83D)}${String.fromCharCode(0xDE00)}`,
      `// \u{1F600}\nlet a = 1;`,
    ]
    for (const input of cases) {
      const jsOutput = transpile(input)
      // the direct binding call bypasses the wrapper entirely: this proves
      // the native path itself is lossless
      expect(transpileUtf16Direct(input)).toBe(jsOutput)
      expect(transpileSync(input)).toBe(jsOutput)
      expect(await transpileAsync(input)).toBe(jsOutput)
    }
  })

  it('matches JS for escaped surrogate enum string values', async () => {
    const input = 'enum E { A = "\\uD800" }'
    const jsOutput = transpile(input)
    // string values keep the raw source text verbatim (escape case intact)
    expect(jsOutput).toContain('\\uD800')
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('matches JS for raw lone-surrogate enum string values (UTF-16 path)', async () => {
    const input = `enum E { A = "${String.fromCharCode(0xD800)}" }`
    const jsOutput = transpile(input)
    expect(jsOutput).toContain(String.fromCharCode(0xD800))
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('decodes CRLF line continuations in enum member keys', async () => {
    const input = 'enum E { "a\\\r\nb" = 3 }'
    const jsOutput = transpile(input)
    expect(jsOutput).toContain('"ab"')
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('matches JS for brace unicode escapes in enum member keys', async () => {
    const input = 'enum E { "\\u{D800}" = 1 }'
    const jsOutput = transpile(input)
    expect(jsOutput).toContain('\\ud800')
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('erases astral-char types correctly with a trailing raw lone surrogate', async () => {
    // regression: the UTF-16 byte map consumed two units per surrogate pair
    // but recorded one entry, shifting every later blank range by a unit and
    // leaving a bare low surrogate in the output
    const input
      = `const x = "😀"; const y: string = "${
        String.fromCharCode(0xD800)
      }";`
    const jsOutput = transpile(input)
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
    // direct binding call: the native path itself is lossless
    const direct = fromUtf16Units(
      nativeRequire().transpileUtf16Sync(toUtf16Units(input)).code,
    )
    expect(direct).toBe(jsOutput)
  })

  it('erases astral-char enum names correctly with a trailing raw lone surrogate', async () => {
    const input
      = `enum ${
        String.fromCodePoint(0x10400)
      } { A = 1 } // ${
        String.fromCharCode(0xD800)}`
    const jsOutput = transpile(input)
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('decodes legacy octal escapes in enum keys per Annex B', async () => {
    const input = 'enum E { "\\400" = 1, "\\777" = 2 }'
    const jsOutput = transpile(input)
    expect(jsOutput).toContain('" 0"')
    expect(jsOutput).toContain('"?7"')
    expect(transpileSync(input)).toBe(jsOutput)
    expect(await transpileAsync(input)).toBe(jsOutput)
  })

  it('keeps raw lone-surrogate enum keys runtime-faithful (intentional divergence)', async () => {
    // The JS entry's key is lossy (U+FFFD) because oxc-parser's Rust-side
    // string value cannot hold the surrogate. The native UTF-16 path
    // re-escapes it as \ud800 — runtime property access on the transpiled
    // output keeps resolving the original member, matching ts-blank-space's
    // semantics. Pinned here as an intentional improvement.
    const input = `enum E { "${String.fromCharCode(0xD800)}" = 1 }`
    const jsOutput = transpile(input)
    expect(jsOutput).toContain('\uFFFD')

    const syncOutput = transpileSync(input)
    expect(syncOutput).toContain('\\ud800')
    expect(syncOutput).not.toContain('\uFFFD')
    const asyncOutput = await transpileAsync(input)
    expect(asyncOutput).toBe(syncOutput)
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
