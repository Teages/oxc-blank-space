import tsBlankSpace from 'ts-blank-space'
import { describe, expect, it } from 'vitest'
import { transpile } from './parity'

/**
 * Unsupported constructs keep their source verbatim in the output (mirroring
 * ts-blank-space) and are reported through `onError`.
 */
describe('unsupported syntax', () => {
  const collect = (input: string): { output: string, reported: string[] } => {
    const reported: string[] = []
    const output = transpile(input, {
      onError: node =>
        reported.push(`${node.type}@${node.start}-${node.end}`),
    })
    return { output, reported }
  }

  it('allows ambient enums', () => {
    // Given: a declare enum
    const input = 'declare enum E1 {}\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: it is blanked without errors
    expect(output).toBe('                  \n')
    expect(reported).toEqual([])
  })

  it('errors on constructor parameter properties', () => {
    // Given: parameter properties of all four kinds
    const input
      = 'class C {\n  constructor(public a, private b, protected c, readonly d) {}\n}\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: one report per parameter property, source preserved
    expect(output).toBe(input)
    expect(reported.length).toBe(4)
    expect(
      reported.every(r => r.startsWith('TSParameterProperty@')),
    ).toBe(true)
  })

  it('errors on legacy `module` declarations', () => {
    // Given: `module` declarations (overlap with the TC39 modules proposal)
    const input
      = 'module A {}\nmodule B { export type T = string; }\ndeclare module M {}\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: all three error; only string-named ambient modules may blank
    expect(output).toBe(input)
    expect(reported.length).toBe(3)
  })

  it('errors on instantiated namespaces', () => {
    // Given: namespaces holding runtime values
    const input
      = 'namespace A { 1; }\nnamespace C { export let x; }\nnamespace G.H { 4; }\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: one error per outer namespace (dotted names count once)
    expect(output).toBe(input)
    expect(reported.length).toBe(3)
  })

  it('silently erases type-only namespaces', () => {
    // Given: a namespace whose body imports a type alias
    const input = 'namespace B { import x = A.x; }\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: the namespace is blanked without an error
    expect(output).not.toContain('namespace')
    expect(reported).toEqual([])
  })

  it('errors on CJS export assignment and import equals', () => {
    // Given: both CJS interop syntaxes
    const exportInput = 'export = 1;\n'
    const importInput = 'import lib = require("");\n'
    // When: transpiled
    const exportResult = collect(exportInput)
    const importResult = collect(importInput)
    // Then: each errors once and keeps the source
    expect(exportResult.output).toBe(exportInput)
    expect(exportResult.reported.length).toBe(1)
    expect(importResult.output).toBe(importInput)
    expect(importResult.reported.length).toBe(1)
  })

  it('errors on prefix type assertions', () => {
    // Given: the legacy `<T>expr` assertion
    const input = 'let x = <string>"test";\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: error + source preserved, matching the reference tool
    expect(output).toBe(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(reported.length).toBe(1)
  })

  it('errors on `as` inside unparenthesized ??-mixes', () => {
    // Given: an assertion inside a `??`/`&&` mix, which TypeScript rejects
    // (ts(5076)) and whose erasure would silently change the parse
    const input = 'const v = a && b as T ?? c;\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: error + source preserved, matching the reference tool
    expect(output).toBe(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(reported.length).toBe(1)
  })

  it('allows safe assertions inside logical chains', () => {
    // Given: assertions that do not change grouping when erased
    const input
      = 'const w = x || y satisfies Z;\nconst v = a && (b as T) + c;\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: they are erased without errors
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(reported).toEqual([])
    expect(output).not.toContain('as')
    expect(output).not.toContain('satisfies')
  })

  it('reports span information usable for diagnostics', () => {
    // Given: a constructor parameter property at a known offset
    const input = 'class C { constructor(private a: string) {} }\n'
    // When: transpiled
    const { reported } = collect(input)
    // Then: the reported span covers the parameter property
    expect(reported).toEqual(['TSParameterProperty@22-39'])
    expect(input.slice(22, 39)).toBe('private a: string')
  })
})
