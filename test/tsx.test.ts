import type { TranspileOptions, UnsupportedSyntax } from '../src/index'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import { blankSourceFile } from 'ts-blank-space'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  transpile as nativeTranspile,
  transpileSync as nativeTranspileSync,
} from '../src/index'
// hard import: a missing or broken wasm build must fail this suite, never
// silently drop the wasm backend (CI builds both artifacts before testing)
import { transpile as wasmTranspile, transpileSync as wasmTranspileSync } from '../src/wasm'
import { createParity } from './parity'
import { cases } from './tsx-cases'
import { corpus } from './tsx-corpus'
import { evaluateBlankedWithTsc, evaluateWithTsc } from './tsx-runtime'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'test/fixture')
const corpusDir = join(fixtureDir, 'tsx-corpus')

/**
 * The shipped ts-blank-space entry hard-codes `ScriptKind.TS`, but its
 * exported `blankSourceFile` accepts any source file — feeding it a
 * `ScriptKind.TSX` one yields the reference implementation's tsx behavior.
 * Auxiliary check only: the reference itself has gaps (JSX type arguments,
 * enum expansion), so matrix rows mark where it must NOT agree.
 */
function tsxBlankSpace(input: string): string {
  return blankSourceFile(
    ts.createSourceFile(
      'input.tsx',
      input,
      { languageVersion: ts.ScriptTarget.ESNext, impliedNodeFormat: ts.ModuleKind.ESNext },
      false,
      ts.ScriptKind.TSX,
    ),
  )
}

interface Backend {
  readonly label: string
  /** sync entry wrapped with sync/async cross-checks */
  readonly transpile: (input: string, options?: TranspileOptions) => string
  /** unwrapped sync entry, for invariants over outputs */
  readonly transpileSync: (input: string, options?: TranspileOptions) => string
}

const backends: readonly Backend[] = [
  {
    label: 'native',
    transpile: createParity('native', nativeTranspile, nativeTranspileSync),
    transpileSync: nativeTranspileSync,
  },
  {
    label: 'wasm',
    transpile: createParity('wasm', wasmTranspile, wasmTranspileSync),
    transpileSync: wasmTranspileSync,
  },
]

/**
 * The output parses as plain JSX — validated through the oxc parser's own
 * diagnostics (a `.jsx`-mode round trip through this transpiler would not
 * catch recoverable diagnostics, since it ignores them by design) — and no
 * TypeScript syntax remains: the blanker passes it back byte-identically.
 */
function expectParsesAsJsx(backend: Backend, output: string): void {
  const parsed = parseSync('check.jsx', output)
  expect(parsed.errors.map(e => e.message), 'output must parse as pure JSX').toEqual([])
  expect(backend.transpileSync(output, { filename: 'check.jsx' })).toBe(output)
}

/**
 * The output's plain-JSX diagnostics match the row's pinned count: rows
 * keeping reported TS constructs (import-equals, namespaces) or carrying
 * input-inherent soft-recovery diagnostics legitimately have some; the pin
 * keeps the count from drifting silently.
 */
function expectJsxDiagnostics(output: string, expectedCount: number): void {
  const parsed = parseSync('check.jsx', output)
  expect(parsed.errors.length, 'pinned .jsx diagnostic count').toBe(expectedCount)
}

/**
 * Outside erased regions the output is byte-identical to the input. An
 * erased region may begin with an ASI-protecting `;` (statement-ending
 * assertions) — every other differing character must be a space.
 */
function expectTextFidelity(input: string, output: string): void {
  expect(output.length, 'erasure must preserve length').toBe(input.length)
  let inRun = false
  for (let i = 0; i < output.length; i++) {
    if (output[i] === input[i]) {
      inRun = false
      continue
    }
    if (!inRun) {
      expect([' ', ';'], `erased region start at position ${i}`).toContain(output[i])
      inRun = true
    }
    else {
      expect(output[i], `position ${i}`).toBe(' ')
    }
  }
}

for (const backend of backends) {
  describe(`tsx support matrix [${backend.label}]`, () => {
    describe('syntax cases', () => {
      for (const c of cases) {
        if (c.kind === 'erasure') {
          it(c.id, () => {
            const reports: UnsupportedSyntax[] = []
            const output = backend.transpile(c.input, {
              lang: 'tsx',
              onError: (node) => {
                reports.push(node)
              },
            })
            expect(reports, 'erasable input must produce no reports').toEqual([])
            if (typeof c.expected === 'string') {
              expect(output).toBe(c.expected)
            }
            else {
              for (const fragment of c.expected.contains) {
                expect(output).toContain(fragment)
              }
            }
            if (c.ref) {
              expect(output, 'reference implementation must agree').toBe(tsxBlankSpace(c.input))
            }
            if (c.fidelity !== false) {
              expectTextFidelity(c.input, output)
            }
            if (c.jsxParseDiagnostics === undefined) {
              expectParsesAsJsx(backend, output)
            }
            else {
              expectJsxDiagnostics(output, c.jsxParseDiagnostics)
            }
            if (c.runtime) {
              const fromInput = evaluateWithTsc(c.input)
              const fromOutput = evaluateBlankedWithTsc(output)
              expect(fromOutput.trace, 'evaluation order must be preserved').toEqual(fromInput.trace)
              expect(fromOutput.tree, 'element structure must be preserved').toEqual(fromInput.tree)
            }
          })
        }
        else if (c.kind === 'parse-error') {
          it(c.id, () => {
            expect(() => backend.transpile(c.input, c.options)).toThrow(SyntaxError)
            expect(() => backend.transpile(c.input, c.options)).toThrow(c.messagePattern)
          })
        }
        else {
          it(c.id, () => {
            const reports: UnsupportedSyntax[] = []
            const output = backend.transpile(c.input, {
              ...c.options,
              onError: (node) => {
                reports.push(node)
              },
            })
            expect(output).toBe(c.expected)
            expect(reports.map(r => r.type)).toEqual(c.reports.map(r => r.type))
            for (const [index, report] of reports.entries()) {
              const wanted = c.reports[index]
              expect(c.input.slice(report.start, report.end), `report #${index} span`).toBe(wanted.slice)
            }
          })
        }
      }
    })

    describe('official corpus (TypeScript v6.0.3)', () => {
      for (const row of corpus) {
        const input = readFileSync(join(corpusDir, 'upstream', row.file), 'utf8')
        if (row.kind === 'parse-error') {
          it(`rejects: ${row.file}`, () => {
            expect(() => backend.transpile(input, { lang: 'tsx' })).toThrow(SyntaxError)
          })
        }
        else {
          it(`corpus: ${row.file}`, () => {
            const expected = readFileSync(
              join(corpusDir, 'expected', row.file.replace(/\.(tsx|ts)$/, '.js')),
              'utf8',
            )
            const reports: UnsupportedSyntax[] = []
            const output = backend.transpile(input, {
              lang: 'tsx',
              onError: (node) => {
                reports.push(node)
              },
            })
            expect(output).toBe(expected)
            expectTextFidelity(input, output)
            if (row.pureJsxOutput) {
              expectParsesAsJsx(backend, output)
            }
            else {
              expectJsxDiagnostics(output, row.jsxModeDiagnostics ?? 0)
            }
            if (row.refParity) {
              expect(output, 'reference implementation must agree').toBe(tsxBlankSpace(input))
            }
            expect(reports.map(r => r.type).join(',')).toBe(row.reports ?? '')
          })
        }
      }
    })

    describe('option forms', () => {
      it('parses identically via lang and via a .tsx filename', () => {
        const input = 'const f = <T,>(x: T): T => <b>{x satisfies T}</b>\n'
        const byLang = backend.transpile(input, { lang: 'tsx' })
        const byFilename = backend.transpile(input, { filename: 'component.tsx' })
        expect(byLang).toBe(byFilename)
        expect(byLang).toBe(tsxBlankSpace(input))
      })
    })

    describe('fixture corpus', () => {
      for (const filename of readdirSync(fixtureDir).filter(f =>
        f.endsWith('.tsx'),
      )) {
        it(`fixture parity: ${filename}`, () => {
          const input = readFileSync(join(fixtureDir, filename), 'utf8')
          const expected = readFileSync(
            join(fixtureDir, filename.replace(/\.tsx$/, '.js')),
            'utf8',
          )
          const output = backend.transpile(input, { lang: 'tsx' })
          expect(output).toBe(expected)
          expect(output).toBe(tsxBlankSpace(input))
          expectParsesAsJsx(backend, output)
        })
      }
    })
  })
}

describe('runtime-equivalence layer guards', () => {
  it('rejects illegal input through tsc diagnostics instead of comparing recovered semantics', () => {
    const input = 'const el = <div></span>;\n'
    expect(() => evaluateWithTsc(input)).toThrow(/typescript failed to compile/)
  })

  it('accepts the matrix runtime inputs without diagnostics', () => {
    for (const c of cases) {
      if (c.kind === 'erasure' && c.runtime) {
        expect(() => evaluateWithTsc(c.input), c.id).not.toThrow()
      }
    }
  })

  it('pins the tsc behavior cited by the unicode-escape divergence note', () => {
    // Given: unicode escapes in JSX tag names — the divergence notes state
    // that the reference compilers reject them with TS17021 (verified
    // against tsc 6.0.3 and tsgo 7.0.2 CLI; the installed devDependency
    // pins the tsc side of that claim in-suite)
    // When/Then: the tsc-based evaluation layer refuses the input with the
    // documented diagnostic — if a typescript upgrade ever accepts this, the
    // divergence notes must be revisited
    expect(() => evaluateWithTsc('const el = <\\u0061>hi</\\u0061>;\n')).toThrow(
      /Unicode escape sequence/,
    )
  })
})
