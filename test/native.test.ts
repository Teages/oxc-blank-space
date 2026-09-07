import type { UnsupportedSyntax } from '../src/index'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tsBlankSpace from 'ts-blank-space'
import { afterAll, describe, expect, it } from 'vitest'
import { transpile, transpileSync } from '../src/index'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixture')

const asyncChecks: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const check of asyncChecks) {
    await check()
  }
})

/** Queue an async run and require it to match the sync output exactly. */
function expectAsyncToMatch(input: string, syncOutput: string, options?: Parameters<typeof transpileSync>[1]) {
  asyncChecks.push(async () => {
    const asyncOutput = await transpile(input, options)
    expect(asyncOutput).toBe(syncOutput)
  })
}

describe('native transpiler', () => {
  for (const filename of readdirSync(fixtureDir).filter(f =>
    f.endsWith('.ts'),
  )) {
    it(`fixture parity: ${filename}`, () => {
      // Given: a case file from the ts-blank-space fixture corpus and its
      // committed expected output
      const input = readFileSync(join(fixtureDir, filename), 'utf8')
      const expected = readFileSync(
        join(fixtureDir, filename.replace(/\.ts$/, '.js')),
        'utf8',
      )
      // When: transpiled
      const output = transpileSync(input)
      // Then: the result matches the reference implementation byte for byte
      expect(output).toBe(expected)
      expect(output).toBe(tsBlankSpace(input))
      expectAsyncToMatch(input, output)
    })
  }

  it('blanks type annotations', () => {
    const input = `const a: number = 1`
    const output = transpileSync(input)
    expect(output).toBe('const a         = 1')
    expectAsyncToMatch(input, output)
  })

  it('expands enums in place', () => {
    const input = `enum Color { Red, Green = 5 }`
    const output = transpileSync(input)
    expect(output).toContain(`Color["Red"] = 0`)
    expectAsyncToMatch(input, output)
  })

  it('reports unsupported constructs through onError', async () => {
    const input = `class C { constructor(private a: string) {} }`
    const nativeReports: UnsupportedSyntax[] = []
    const output = transpileSync(input, {
      onError: node => nativeReports.push(node),
    })
    expect(output.length).toBe(input.length)
    // parameter properties are kept verbatim and only reported
    expect(output).toContain('private a')
    expect(output).not.toContain(': string')
    expect(nativeReports[0]).toMatchObject({ type: 'TSParameterProperty' })
    expect(await transpile(input, {
      onError: node => nativeReports.push(node),
    })).toBe(output)
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

  it('supports the tsx language mode', () => {
    const input = `const el = <div prop={'a' as const}>hi</div>\n`
    const output = transpileSync(input, { lang: 'tsx' })
    expect(output).not.toContain('as')
    expect(output).toContain('<div prop')
    expectAsyncToMatch(input, output, { lang: 'tsx' })
  })

  it('honors the filename option for JSX parsing', () => {
    const input = `const el = <a href>link</a>\n`
    const output = transpileSync(input, { filename: 'input.tsx' })
    expect(output.length).toBe(input.length)
    expect(output).toContain('<a href>')
    expectAsyncToMatch(input, output, { filename: 'input.tsx' })
  })

  it('rejects unparseable input with a SyntaxError', async () => {
    const input = `const a: = ;`
    expect(() => transpileSync(input)).toThrow(SyntaxError)
    expect(() => transpileSync(input)).toThrow(/failed to parse input\.ts/)
    await expect(transpile(input)).rejects.toThrow(SyntaxError)
  })

  it('reports onError offsets as UTF-16 character offsets for non-ASCII input', () => {
    // `文` is 1 UTF-16 unit but 3 UTF-8 bytes, `😀` is 2 units / 4 bytes —
    // offsets are character-based, not byte-based.
    const input = `const 文 = "😀"; export = foo;`
    const nativeReports: UnsupportedSyntax[] = []
    transpileSync(input, { onError: node => nativeReports.push(node) })
    const [report] = nativeReports
    expect(input.slice(report.start, report.end)).toBe('export = foo;')
  })

  it('formats large enum constants with JS shortest round-trip digits', () => {
    // the double nearest to 1000000000000000100 prints with JS shortest
    // round-trip digits, not its exact binary value ...128
    const input = `enum E { A = 1000000000000000100 }`
    const output = transpileSync(input)
    expect(output).toContain('1000000000000000100')
    expect(output).not.toContain('1000000000000000128')
    expectAsyncToMatch(input, output)
  })

  it('propagates onError exceptions unchanged from both entries', async () => {
    const input = `class C { constructor(private a: string) {} }`
    const sentinel = new Error('sentinel from onError')
    await expect(
      transpile(input, {
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

  it('serves raw lone surrogates through the UTF-16 native path', () => {
    // Raw lone surrogates cannot survive the UTF-8 boundary into Rust, so
    // inputs containing one are routed to the UTF-16 entry points, which
    // round-trip the original code units losslessly.
    const input = `// ${String.fromCharCode(0xD800)}\nlet a = 1;`
    const output = transpileSync(input)
    expect(output).toContain(String.fromCharCode(0xD800))
    expectAsyncToMatch(input, output)
  })

  it('re-escapes escaped lone-surrogate enum member keys', () => {
    // pure-ASCII source whose decoded member name contains lone surrogates;
    // JSON.stringify re-escapes them exactly like the reference emitter
    const input = String.raw`enum E { "\uD800" = 1, "\uDC00" = 2 }`
    const output = transpileSync(input)
    expect(output).toContain('\\ud800')
    expectAsyncToMatch(input, output)
  })

  it('preserves raw lone surrogates in strings and comments losslessly', () => {
    const cases = [
      `let s = "${String.fromCharCode(0xD800)}"`,
      `let s = "${String.fromCharCode(0xD800)}"\n// ${String.fromCharCode(0xDC00)}`,
      `enum E { A = 1 } // ${String.fromCharCode(0xD83D)}${String.fromCharCode(0xDE00)}`,
      `// \u{1F600}\nlet a = 1;`,
    ]
    for (const input of cases) {
      const output = transpileSync(input)
      // nothing is lost to UTF-8 replacement characters
      expect(output).not.toContain('\uFFFD')
      expectAsyncToMatch(input, output)
    }
    // the raw lone surrogates and the paired emoji survive verbatim
    expect(transpileSync(cases[0])).toBe(cases[0])
    expect(transpileSync(cases[1])).toBe(cases[1])
    expect(transpileSync(cases[2])).toContain(
      `${String.fromCharCode(0xD83D)}${String.fromCharCode(0xDE00)}`,
    )
  })

  it('keeps escaped surrogate enum string values verbatim', () => {
    const input = 'enum E { A = "\\uD800" }'
    const output = transpileSync(input)
    // string values keep the raw source text (escape case intact)
    expect(output).toContain('\\uD800')
    expectAsyncToMatch(input, output)
  })

  it('preserves raw lone-surrogate enum string values (UTF-16 path)', () => {
    const input = `enum E { A = "${String.fromCharCode(0xD800)}" }`
    const output = transpileSync(input)
    expect(output).toContain(String.fromCharCode(0xD800))
    expect(output).not.toContain('\uFFFD')
    expectAsyncToMatch(input, output)
  })

  it('decodes CRLF line continuations in enum member keys', () => {
    const input = 'enum E { "a\\\r\nb" = 3 }'
    const output = transpileSync(input)
    expect(output).toContain('"ab"')
    expectAsyncToMatch(input, output)
  })

  it('decodes brace unicode escapes in enum member keys', () => {
    const input = 'enum E { "\\u{D800}" = 1 }'
    const output = transpileSync(input)
    expect(output).toContain('\\ud800')
    expectAsyncToMatch(input, output)
  })

  it('erases astral-char types correctly with a trailing raw lone surrogate', () => {
    // regression: the UTF-16 byte map consumed two units per surrogate pair
    // but recorded one entry, shifting every later blank range by a unit and
    // leaving a bare low surrogate in the output
    const input
      = `const x = "😀"; const y: string = "${
        String.fromCharCode(0xD800)
      }";`
    const output = transpileSync(input)
    expect(output.length).toBe(input.length)
    expect(output).toContain(String.fromCharCode(0xD800))
    expect(output).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    expectAsyncToMatch(input, output)
  })

  it('erases astral-char enum names correctly with a trailing raw lone surrogate', () => {
    const input
      = `enum ${
        String.fromCodePoint(0x10400)
      } { A = 1 } // ${
        String.fromCharCode(0xD800)}`
    const output = transpileSync(input)
    expect(output).toContain(String.fromCodePoint(0x10400))
    expect(output).toContain(String.fromCharCode(0xD800))
    expectAsyncToMatch(input, output)
  })

  it('decodes legacy octal escapes in enum keys per Annex B', () => {
    const input = 'enum E { "\\400" = 1, "\\777" = 2 }'
    const output = transpileSync(input)
    expect(output).toContain('" 0"')
    expect(output).toContain('"?7"')
    expectAsyncToMatch(input, output)
  })

  it('keeps raw lone-surrogate enum keys runtime-faithful', () => {
    // A lossy U+FFFD key would break runtime property access on the
    // transpiled output; the UTF-16 path re-escapes it as \ud800 so the
    // original member keeps resolving, matching ts-blank-space's semantics.
    const input = `enum E { "${String.fromCharCode(0xD800)}" = 1 }`
    const output = transpileSync(input)
    expect(output).toContain('\\ud800')
    expect(output).not.toContain('\uFFFD')
    const E = new Function(`${output}; return E;`)()
    expect(E[String.fromCharCode(0xD800)]).toBe(1)
    expectAsyncToMatch(input, output)
  })

  it('parses unknown-extension filenames as plain JavaScript', async () => {
    // unknown/no extension parses as plain JS (module, no JSX): TS/JSX syntax
    // must throw, plain JS must pass through
    const filenames = ['input', 'input.txt', 'input.json', 'input.vue', 'Makefile']
    for (const filename of filenames) {
      expect(() => transpileSync('const x: number = 1;', { filename })).toThrow(SyntaxError)
      expect(() => transpileSync('const el = <div/>', { filename })).toThrow(SyntaxError)
      await expect(transpile('const el = <div/>', { filename })).rejects.toThrow(SyntaxError)
      expect(transpileSync('const x = 1;', { filename })).toBe('const x = 1;')
    }
  })

  it('produces identical SyntaxError messages on both entries', async () => {
    // codeframes render with the same oxc reporter on both paths
    const input = 'let a: string = 1'
    const filename = 'app.js'
    const capture = async (run: () => Promise<unknown> | unknown): Promise<string> => {
      try {
        await run()
      }
      catch (error) {
        return (error as SyntaxError).message
      }
      return expect.fail('expected the input to be rejected')
    }
    const syncMessage = await capture(() => transpileSync(input, { filename }))
    const asyncMessage = await capture(() => transpile(input, { filename }))
    expect(syncMessage).toContain('failed to parse app.js:')
    expect(syncMessage).toContain(',-[app.js:1:6]')
    expect(asyncMessage).toBe(syncMessage)
  })

  it('formats seeded random doubles exactly like JS Number.prototype.toString', async () => {
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

    for (const [index, value] of values.entries()) {
      const input = `enum E { A = ${String(value)} }`
      const output = transpileSync(input)
      expect(output).toContain(`E["A"] = ${String(value)}]`)
      // the full sweep runs on the sync path; spot-check the structured
      // edges on the async path to keep the suite fast
      if (index < values.length - 10) {
        continue
      }
      await expect(transpile(input)).resolves.toContain(`E["A"] = ${String(value)}]`)
    }
  })

  it('rejects grouping-unsafe as-erasures with a SyntaxError', async () => {
    // `1 + 1 as T / 2` would change meaning when the assertion is erased;
    // oxc refuses to parse it, and the binding must surface that.
    const input = `1 + 1 as T / 2;\n`
    expect(() => transpileSync(input)).toThrow(SyntaxError)
    await expect(transpile(input)).rejects.toThrow(SyntaxError)
  })
})
