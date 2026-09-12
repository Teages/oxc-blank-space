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
    const input = 'declare enum E1 {}\n'
    const { output, reported } = collect(input)
    expect(output).toBe('                  \n')
    expect(reported).toEqual([])
  })

  it('errors on constructor parameter properties', () => {
    const input
      = 'class C {\n  constructor(public a, private b, protected c, readonly d) {}\n}\n'
    const { output, reported } = collect(input)
    expect(output).toBe(input)
    expect(reported.length).toBe(4)
    expect(
      reported.every(r => r.startsWith('TSParameterProperty@')),
    ).toBe(true)
  })

  it('errors on legacy `module` declarations', () => {
    // `module` declarations overlap with the TC39 modules proposal
    const input
      = 'module A {}\nmodule B { export type T = string; }\ndeclare module M {}\n'
    const { output, reported } = collect(input)
    expect(output).toBe(input)
    expect(reported.length).toBe(3)
  })

  it('errors on instantiated namespaces', () => {
    const input
      = 'namespace A { 1; }\nnamespace C { export let x; }\nnamespace G.H { 4; }\n'
    const { output, reported } = collect(input)
    expect(output).toBe(input)
    expect(reported.length).toBe(3)
  })

  it('silently erases type-only namespaces', () => {
    const input = 'namespace B { import x = A.x; }\n'
    const { output, reported } = collect(input)
    expect(output).not.toContain('namespace')
    expect(reported).toEqual([])
  })

  it('errors on CJS export assignment and import equals', () => {
    const exportInput = 'export = 1;\n'
    const importInput = 'import lib = require("");\n'
    const exportResult = collect(exportInput)
    const importResult = collect(importInput)
    expect(exportResult.output).toBe(exportInput)
    expect(exportResult.reported.length).toBe(1)
    expect(importResult.output).toBe(importInput)
    expect(importResult.reported.length).toBe(1)
  })

  it('errors on prefix type assertions', () => {
    const input = 'let x = <string>"test";\n'
    const { output, reported } = collect(input)
    expect(output).toBe(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(reported.length).toBe(1)
  })

  it('errors on `as` inside unparenthesized ??-mixes', () => {
    // TypeScript rejects this mix (ts(5076)); erasing the assertion would silently change the parse
    const input = 'const v = a && b as T ?? c;\n'
    const { output, reported } = collect(input)
    expect(output).toBe(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(reported.length).toBe(1)
  })

  it('allows safe assertions inside logical chains', () => {
    const input
      = 'const w = x || y satisfies Z;\nconst v = a && (b as T) + c;\n'
    const { output, reported } = collect(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(reported).toEqual([])
    expect(output).not.toContain('as')
    expect(output).not.toContain('satisfies')
  })

  it('reports span information usable for diagnostics', () => {
    const input = 'class C { constructor(private a: string) {} }\n'
    const { reported } = collect(input)
    expect(reported).toEqual(['TSParameterProperty@22-39'])
    expect(input.slice(22, 39)).toBe('private a: string')
  })
})
